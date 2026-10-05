import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Injectable, Module, NotFoundException } from '@nestjs/common';
import { IsEmail, IsOptional, IsString } from 'class-validator';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';

export class CreateProveedorDto {
  @IsString()
  nombre!: string;

  @IsOptional()
  @IsString()
  ruc?: string;

  @IsOptional()
  @IsString()
  contacto?: string;

  @IsOptional()
  @IsString()
  telefono?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  direccion?: string;
}

type ProveedorRow = Record<string, unknown> & { id: string; tenantId: string };

type Db = {
  proveedor: {
    findUnique: (a: unknown) => Promise<ProveedorRow | null>;
    findMany: (a: unknown) => Promise<ProveedorRow[]>;
    create: (a: unknown) => Promise<ProveedorRow>;
    update: (a: unknown) => Promise<ProveedorRow>;
  };
};

@Injectable()
export class ProveedoresService {
  constructor(private readonly prisma: PrismaService) {}
  private get db(): Db {
    return this.prisma as unknown as Db;
  }

  async listar(): Promise<ProveedorRow[]> {
    requireTenant();
    return this.db.proveedor.findMany({ where: { deletedAt: null }, orderBy: { nombre: 'asc' } });
  }

  async obtener(id: string): Promise<ProveedorRow> {
    const ctx = requireTenant();
    const p = await this.db.proveedor.findUnique({ where: { id } });
    if (!p || p.tenantId !== ctx.tenantId) throw new NotFoundException('Proveedor no encontrado');
    return p;
  }

  async crear(dto: CreateProveedorDto): Promise<ProveedorRow> {
    const ctx = requireTenant();
    return this.db.proveedor.create({
      data: { ...dto, tenantId: ctx.tenantId },
    });
  }

  async actualizar(id: string, dto: Partial<CreateProveedorDto>): Promise<ProveedorRow> {
    await this.obtener(id);
    const { tenantId: _ignored, ...resto } = dto as Record<string, unknown>;
    return this.db.proveedor.update({ where: { id }, data: resto });
  }
}

@Controller('proveedores')
export class ProveedoresController {
  constructor(private readonly service: ProveedoresService) {}

  @Get()
  listar(): Promise<unknown> {
    return this.service.listar();
  }

  @Post()
  @RequirePermission('inventory.write')
  crear(@Body() dto: CreateProveedorDto): Promise<unknown> {
    return this.service.crear(dto);
  }

  @Get(':id')
  obtener(@Param('id') id: string): Promise<unknown> {
    return this.service.obtener(id);
  }

  @Patch(':id')
  @RequirePermission('inventory.write')
  actualizar(@Param('id') id: string, @Body() dto: Partial<CreateProveedorDto>): Promise<unknown> {
    return this.service.actualizar(id, dto);
  }
}

@Module({ controllers: [ProveedoresController], providers: [ProveedoresService] })
export class ProveedoresModule {}
