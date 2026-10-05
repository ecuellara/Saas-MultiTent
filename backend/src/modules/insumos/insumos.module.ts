import { BadRequestException, Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';

export class SalidaDto {
  @IsInt()
  @Min(1)
  cantidad!: number;

  @IsOptional()
  @IsString()
  motivo?: string;
}

export class CreateInsumoDto {
  @IsString()
  nombre!: string;

  @IsOptional()
  @IsString()
  sedeId?: string;

  @IsOptional()
  @IsString()
  unidad?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  stockMinimo?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stockActual?: number;
}

type InsumoRow = Record<string, unknown> & { id: string; tenantId: string; stockActual: number };

type Db = {
  insumo: {
    findUnique: (a: unknown) => Promise<InsumoRow | null>;
    findMany: (a: unknown) => Promise<InsumoRow[]>;
    create: (a: unknown) => Promise<InsumoRow>;
    update: (a: unknown) => Promise<InsumoRow>;
  };
  sede: { findFirst: (a: unknown) => Promise<{ id: string } | null> };
  movimientoInventario: { create: (a: unknown) => Promise<unknown> };
};

@Injectable()
export class InsumosService {
  constructor(private readonly prisma: PrismaService) {}
  private get db(): Db {
    return this.prisma as unknown as Db;
  }

  async listar(): Promise<InsumoRow[]> {
    requireTenant();
    return this.db.insumo.findMany({ where: { deletedAt: null }, orderBy: { nombre: 'asc' } });
  }

  async obtener(id: string): Promise<InsumoRow> {
    const ctx = requireTenant();
    const i = await this.db.insumo.findUnique({ where: { id } });
    if (!i || i.tenantId !== ctx.tenantId) throw new NotFoundException('Insumo no encontrado');
    return i;
  }

  async crear(dto: CreateInsumoDto): Promise<InsumoRow> {
    const ctx = requireTenant();
    const sedeId = dto.sedeId ?? ctx.sedeId ?? (await this.sedePrincipalId());
    if (!sedeId) throw new BadRequestException('sedeId requerida');
    return this.db.insumo.create({
      data: {
        tenantId: ctx.tenantId,
        sedeId,
        nombre: dto.nombre,
        unidad: dto.unidad ?? 'und',
        stockMinimo: dto.stockMinimo ?? 0,
        stockActual: dto.stockActual ?? 0,
      },
    });
  }

  async salida(id: string, dto: SalidaDto): Promise<InsumoRow> {
    return this.mover(id, 'salida', dto.cantidad, dto.motivo);
  }

  async entrada(id: string, dto: SalidaDto): Promise<InsumoRow> {
    return this.mover(id, 'entrada', dto.cantidad, dto.motivo);
  }

  private async mover(id: string, tipo: 'entrada' | 'salida', cantidad: number, motivo?: string): Promise<InsumoRow> {
    const ctx = requireTenant();
    const insumo = await this.obtener(id);
    const stock = insumo.stockActual;
    if (tipo === 'salida' && cantidad > stock) {
      throw new BadRequestException('Stock insuficiente');
    }
    const nuevo = tipo === 'salida' ? stock - cantidad : stock + cantidad;
    await this.db.movimientoInventario.create({
      data: {
        tenantId: ctx.tenantId,
        insumoId: id,
        tipo,
        cantidad,
        stockAnterior: stock,
        stockNuevo: nuevo,
        motivo: motivo ?? null,
        usuarioId: ctx.userId,
      },
    });
    return this.db.insumo.update({ where: { id }, data: { stockActual: nuevo } });
  }

  private async sedePrincipalId(): Promise<string | null> {
    const ctx = requireTenant();
    const sede = await this.db.sede.findFirst({
      where: { tenantId: ctx.tenantId, esPrincipal: true },
    });
    return sede?.id ?? null;
  }
}

@Controller('insumos')
export class InsumosController {
  constructor(private readonly service: InsumosService) {}

  @Get()
  listar(): Promise<unknown> {
    return this.service.listar();
  }

  @Post()
  @RequirePermission('inventory.write')
  crear(@Body() dto: CreateInsumoDto): Promise<unknown> {
    return this.service.crear(dto);
  }

  @Get(':id')
  obtener(@Param('id') id: string): Promise<unknown> {
    return this.service.obtener(id);
  }

  @Post(':id/salidas')
  @RequirePermission('inventory.write')
  salida(@Param('id') id: string, @Body() dto: SalidaDto): Promise<unknown> {
    return this.service.salida(id, dto);
  }

  @Post(':id/entradas')
  @RequirePermission('inventory.write')
  entrada(@Param('id') id: string, @Body() dto: SalidaDto): Promise<unknown> {
    return this.service.entrada(id, dto);
  }

  @Patch(':id')
  async ajustar(): Promise<unknown> {
    throw new BadRequestException('Use entradas/salidas');
  }
}

@Module({ controllers: [InsumosController], providers: [InsumosService] })
export class InsumosModule {}
