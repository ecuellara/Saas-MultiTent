import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Injectable, Module, NotFoundException } from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { EntitlementsService } from '../../core/entitlements/entitlements.service.js';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';

export class CreateMembershipDto {
  @ApiProperty()
  @IsString()
  userId!: string;

  @ApiProperty()
  @IsString()
  roleId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sedeId?: string;
}

export class UpdateMembershipDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  roleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  estado?: string;
}

type MembershipRow = Record<string, unknown> & { id: string; tenantId: string };

type Db = {
  membership: {
    findMany: (a: unknown) => Promise<MembershipRow[]>;
    findUnique: (a: unknown) => Promise<MembershipRow | null>;
    create: (a: unknown) => Promise<MembershipRow>;
    update: (a: unknown) => Promise<MembershipRow>;
  };
  user: { findUnique: (a: unknown) => Promise<{ id: string } | null> };
  role: { findUnique: (a: unknown) => Promise<{ tenantId: string } | null> };
  sede: { findUnique: (a: unknown) => Promise<{ tenantId: string } | null> };
};

@Injectable()
export class MembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}
  private get db(): Db {
    return this.prisma as unknown as Db;
  }

  /**
   * Lista el equipo de la clínica.
   *
   * `include: { user: true }` traía la fila **completa** de `User`: con eso
   * `passwordHash`, `passwordAlgo` y `mfaSecret` viajaban al cliente. Un
   * `select` explícito deja fuera todo lo que la interfaz no necesita.
   */
  listar(): Promise<MembershipRow[]> {
    requireTenant();
    return this.db.membership.findMany({
      select: {
        id: true,
        tenantId: true,
        userId: true,
        roleId: true,
        sedeId: true,
        estado: true,
        joinedAt: true,
        user: { select: { id: true, email: true, nombre: true } },
        role: { select: { id: true, codigo: true, nombre: true } },
      },
      orderBy: { joinedAt: 'asc' },
    } as unknown as object) as Promise<MembershipRow[]>;
  }

  async crear(dto: CreateMembershipDto): Promise<MembershipRow> {
    const ctx = requireTenant();
    const user = await this.db.user.findUnique({ where: { id: dto.userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    const role = await this.db.role.findUnique({ where: { id: dto.roleId } });
    if (!role || role.tenantId !== ctx.tenantId) throw new NotFoundException('Rol no encontrado');
    if (dto.sedeId) {
      const sede = await this.db.sede.findUnique({ where: { id: dto.sedeId } });
      if (!sede || sede.tenantId !== ctx.tenantId) throw new NotFoundException('Sede no encontrada');
    }
    // El recuento de membresías ACTIVE y el alta van en la MISMA transacción
    // (`crearConLimite`), con el lock de fila del tenant tomado: N altas
    // simultáneas ya no pueden pasar todas el `max_usuarios` del plan.
    return this.entitlements.crearConLimite<MembershipRow, Db>(
      ctx.tenantId,
      'max_usuarios',
      (tx) =>
        tx.membership.create({
          data: {
            tenantId: ctx.tenantId,
            userId: dto.userId,
            roleId: dto.roleId,
            sedeId: dto.sedeId ?? ctx.sedeId ?? null,
          },
        }),
    );
  }

  async actualizar(id: string, dto: UpdateMembershipDto): Promise<MembershipRow> {
    const ctx = requireTenant();
    const m = await this.db.membership.findUnique({ where: { id } });
    if (!m || m.tenantId !== ctx.tenantId) throw new NotFoundException('Membresía no encontrada');
    if (dto.roleId) {
      const role = await this.db.role.findUnique({ where: { id: dto.roleId } });
      if (!role || role.tenantId !== ctx.tenantId) throw new NotFoundException('Rol no encontrado');
    }
    if (dto.sedeId) {
      const sede = await this.db.sede.findUnique({ where: { id: dto.sedeId } });
      if (!sede || sede.tenantId !== ctx.tenantId) throw new NotFoundException('Sede no encontrada');
    }
    const { tenantId: _ignored, ...resto } = dto as Record<string, unknown>;
    return this.db.membership.update({ where: { id }, data: resto });
  }
}

@ApiTags('memberships')
@Controller('memberships')
export class MembershipsController {
  constructor(private readonly service: MembershipsService) {}

  @Get()
  @RequirePermission('members.manage')
  listar(): Promise<unknown> {
    return this.service.listar();
  }

  @Post()
  @RequirePermission('members.manage')
  crear(@Body() dto: CreateMembershipDto): Promise<unknown> {
    return this.service.crear(dto);
  }

  @Patch(':id')
  @RequirePermission('members.manage')
  actualizar(@Param('id') id: string, @Body() dto: UpdateMembershipDto): Promise<unknown> {
    return this.service.actualizar(id, dto);
  }
}

@Module({ controllers: [MembershipsController], providers: [MembershipsService] })
export class MembershipsModule {}
