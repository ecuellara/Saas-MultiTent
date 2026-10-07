import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { Injectable, Module, NotFoundException } from '@nestjs/common';
import { IsEmail, IsString } from 'class-validator';
import { EntitlementsService } from '../../core/entitlements/entitlements.service.js';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';
import { hashPassword, validarPassword } from '../../core/auth/passwords.js';

export class CreateUsuarioDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  password!: string;

  @ApiProperty()
  @IsString()
  nombre!: string;

  @ApiProperty()
  @IsString()
  roleId!: string;

  @ApiProperty()
  @IsString()
  sedeId!: string;
}

type MembershipRow = { tenantId: string };

type UserRow = Record<string, unknown> & {
  id: string;
  memberships?: MembershipRow[];
};

/**
 * Delegados que usa el módulo. Se reutiliza como tipo del cliente de
 * transacción que entrega `EntitlementsService.crearConLimite`.
 */
type DbUsuarios = {
  role: { findUnique: (a: unknown) => Promise<{ tenantId: string } | null> };
  sede: { findUnique: (a: unknown) => Promise<{ tenantId: string } | null> };
  user: {
    findUnique: (a: unknown) => Promise<{ id: string } | null>;
    create: (a: unknown) => Promise<Record<string, unknown>>;
  };
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
      // Invariante 3: se nombran solo los campos que necesita la respuesta.
      // `passwordHash`, `passwordAlgo` y `mfaSecret` no salen de aquí (el
      // destructuring de abajo es la segunda barrera, no la primera).
      select: {
        id: true, email: true, nombre: true, cop: true, estado: true,
        mfaEnabled: true, lastLoginAt: true, createdAt: true, updatedAt: true,
        memberships: {
          select: {
            id: true, tenantId: true, userId: true, roleId: true, sedeId: true,
            estado: true, joinedAt: true,
          },
        },
      },
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
    const db = this.prisma as unknown as DbUsuarios;
    const existente = await db.user.findUnique({ where: { email: dto.email } });
    if (existente) throw new BadRequestException('Email ya registrado');
    const role = await db.role.findUnique({ where: { id: dto.roleId } });
    if (!role || role.tenantId !== ctx.tenantId) throw new NotFoundException('Rol no encontrado');
    const sede = await db.sede.findUnique({ where: { id: dto.sedeId } });
    if (!sede || sede.tenantId !== ctx.tenantId) throw new NotFoundException('Sede no encontrada');
    // El hash (argon2id) es caro: se calcula fuera de la transacción, que solo
    // debe contener el recuento del límite y la inserción.
    const passwordHash = await hashPassword(dto.password);
    // Límite y alta atómicos (`crearConLimite`): con el lock del tenant tomado
    // se recuentan las `Membership` ACTIVE, así que N altas simultáneas no
    // pueden superar el `max_usuarios` del plan.
    return this.entitlements.crearConLimite<Record<string, unknown>, DbUsuarios>(
      ctx.tenantId,
      'max_usuarios',
      async (tx) => {
        const creado = await tx.user.create({
          data: {
            email: dto.email,
            passwordHash,
            passwordAlgo: 'argon2id',
            nombre: dto.nombre,
            memberships: {
              create: { tenantId: ctx.tenantId, roleId: dto.roleId, sedeId: dto.sedeId },
            },
          },
          // Invariante 3: sin `passwordHash`/`mfaSecret` desde la consulta.
          select: {
            id: true, email: true, nombre: true, cop: true, estado: true,
            mfaEnabled: true, createdAt: true, updatedAt: true,
            memberships: {
              select: {
                id: true, tenantId: true, userId: true, roleId: true, sedeId: true,
                estado: true, joinedAt: true,
              },
            },
          },
        });
        return creado;
      },
    );
  }
}

@ApiTags('usuarios')
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
