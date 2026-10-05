import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Injectable, Module, NotFoundException } from '@nestjs/common';
import { IsEmail, IsString } from 'class-validator';
import { EntitlementsService } from '../../core/entitlements/entitlements.service.js';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';
import { hashPassword, validarPassword } from '../../core/auth/passwords.js';

export class CreateUsuarioDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;

  @IsString()
  nombre!: string;

  @IsString()
  roleId!: string;

  @IsString()
  sedeId!: string;
}

type MembershipRow = { tenantId: string };

type UserRow = Record<string, unknown> & {
  id: string;
  memberships?: MembershipRow[];
};

@Injectable()
export class UsuariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async obtener(id: string): Promise<Record<string, unknown>> {
    const ctx = requireTenant();
    const db = this.prisma as unknown as {
      user: { findUnique: (a: unknown) => Promise<UserRow | null> };
    };
    const u = await db.user.findUnique({
      where: { id },
      include: { memberships: true },
    });
    const pertenece = (u?.memberships ?? []).some((m) => m.tenantId === ctx.tenantId);
    if (!u || !pertenece) throw new NotFoundException('Usuario no encontrado');
    const { passwordHash: _omit, mfaSecret: _omit2, ...seguro } = u;
    return seguro;
  }

  /** Alta de usuario clínico: sin contraseñas por defecto (bloqueador #2). */
  async crear(dto: CreateUsuarioDto): Promise<Record<string, unknown>> {
    const ctx = requireTenant();
    try {
      validarPassword(dto.password);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const db = this.prisma as unknown as {
      role: { findUnique: (a: unknown) => Promise<{ tenantId: string } | null> };
      sede: { findUnique: (a: unknown) => Promise<{ tenantId: string } | null> };
      membership: { count: (a: unknown) => Promise<number> };
      user: {
        findUnique: (a: unknown) => Promise<{ id: string } | null>;
        create: (a: unknown) => Promise<Record<string, unknown>>;
      };
    };
    const existente = await db.user.findUnique({ where: { email: dto.email } });
    if (existente) throw new BadRequestException('Email ya registrado');
    const role = await db.role.findUnique({ where: { id: dto.roleId } });
    if (!role || role.tenantId !== ctx.tenantId) throw new NotFoundException('Rol no encontrado');
    const sede = await db.sede.findUnique({ where: { id: dto.sedeId } });
    if (!sede || sede.tenantId !== ctx.tenantId) throw new NotFoundException('Sede no encontrada');
    const activos = await db.membership.count({
      where: { tenantId: ctx.tenantId, estado: 'ACTIVE' },
    });
    await this.entitlements.checkLimit(ctx.tenantId, 'max_usuarios', activos);
    const passwordHash = await hashPassword(dto.password);
    const creado = await db.user.create({
      data: {
        email: dto.email,
        passwordHash,
        passwordAlgo: 'argon2id',
        nombre: dto.nombre,
        memberships: {
          create: { tenantId: ctx.tenantId, roleId: dto.roleId, sedeId: dto.sedeId },
        },
      },
      include: { memberships: true },
    });
    const { passwordHash: _omit, mfaSecret: _omit2, ...seguro } = creado;
    return seguro;
  }
}

@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly service: UsuariosService) {}

  @Post()
  @RequirePermission('users.manage')
  crear(@Body() dto: CreateUsuarioDto): Promise<unknown> {
    return this.service.crear(dto);
  }

  @Get(':id')
  obtener(@Param('id') id: string): Promise<unknown> {
    return this.service.obtener(id);
  }
}

@Module({ controllers: [UsuariosController], providers: [UsuariosService] })
export class UsuariosModule {}
