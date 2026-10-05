import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { BadRequestException, Injectable, Module, NotFoundException } from '@nestjs/common';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';

export class CreateRoleDto {
  @ApiProperty({ example: 'RECEPCION' })
  @IsString()
  codigo!: string;

  @ApiProperty({ example: 'Recepción' })
  @IsString()
  nombre!: string;
}

export class SetPermisosDto {
  @ApiProperty({ example: ['patients.read', 'appointments.write'] })
  @IsArray()
  @IsString({ each: true })
  codigos!: string[];
}

type RoleRow = Record<string, unknown> & { id: string; tenantId: string; esSistema: boolean };

type Db = {
  role: {
    findMany: (a: unknown) => Promise<RoleRow[]>;
    findUnique: (a: unknown) => Promise<RoleRow | null>;
    create: (a: unknown) => Promise<RoleRow>;
    update: (a: unknown) => Promise<RoleRow>;
    delete: (a: unknown) => Promise<unknown>;
  };
  permission: {
    findMany: (a: unknown) => Promise<Array<{ id: string; codigo: string }>>;
  };
  rolePermission: {
    deleteMany: (a: unknown) => Promise<unknown>;
    createMany: (a: unknown) => Promise<unknown>;
  };
};

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}
  private get db(): Db {
    return this.prisma as unknown as Db;
  }

  listar(): Promise<RoleRow[]> {
    requireTenant();
    return this.db.role.findMany({
      where: { deletedAt: null },
      include: { permisos: { include: { permission: true } } },
      orderBy: { codigo: 'asc' },
    } as unknown as object) as Promise<RoleRow[]>;
  }

  async obtener(id: string): Promise<RoleRow> {
    const ctx = requireTenant();
    const r = await this.db.role.findUnique({
      where: { id },
      include: { permisos: { include: { permission: true } } },
    } as unknown as object) as (RoleRow & { deletedAt?: Date | null }) | null;
    if (!r || r.tenantId !== ctx.tenantId || r.deletedAt) {
      throw new NotFoundException('Rol no encontrado');
    }
    return r;
  }

  async crear(dto: CreateRoleDto): Promise<RoleRow> {
    const ctx = requireTenant();
    return this.db.role.create({
      data: { tenantId: ctx.tenantId, codigo: dto.codigo, nombre: dto.nombre },
    });
  }

  async asignarPermisos(id: string, dto: SetPermisosDto): Promise<RoleRow> {
    const ctx = requireTenant();
    await this.obtener(id);
    const todos = await this.db.permission.findMany({
      where: { codigo: { in: dto.codigos } },
    });
    if (todos.length !== new Set(dto.codigos).size) {
      throw new BadRequestException('Códigos de permiso desconocidos');
    }
    await this.db.rolePermission.deleteMany({ where: { roleId: id } });
    await this.db.rolePermission.createMany({
      data: todos.map((p) => ({ roleId: id, permissionId: p.id })),
    });
    // El TenantGuard recarga permisos en cada petición: el cambio aplica al
    // siguiente request sin invalidar sesiones.
    void ctx;
    return this.obtener(id);
  }

  async eliminar(id: string): Promise<{ id: string }> {
    const r = await this.obtener(id);
    if (r.esSistema) throw new BadRequestException('Los roles de sistema no se eliminan');
    // Soft delete: el borrado físico queda fuera de la API (doc §13 N1-5).
    await this.db.role.update({ where: { id }, data: { deletedAt: new Date() } });
    return { id };
  }
}

@ApiTags('roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly service: RolesService) {}

  @Get()
  @RequirePermission('roles.manage')
  listar(): Promise<unknown> {
    return this.service.listar();
  }

  @Post()
  @RequirePermission('roles.manage')
  crear(@Body() dto: CreateRoleDto): Promise<unknown> {
    return this.service.crear(dto);
  }

  @Get(':id')
  @RequirePermission('roles.manage')
  obtener(@Param('id') id: string): Promise<unknown> {
    return this.service.obtener(id);
  }

  @Patch(':id/permisos')
  @RequirePermission('roles.manage')
  permisos(@Param('id') id: string, @Body() dto: SetPermisosDto): Promise<unknown> {
    return this.service.asignarPermisos(id, dto);
  }

  @Delete(':id')
  @RequirePermission('roles.manage')
  eliminar(@Param('id') id: string): Promise<unknown> {
    return this.service.eliminar(id);
  }
}

@Module({ controllers: [RolesController], providers: [RolesService] })
export class RolesModule {}
