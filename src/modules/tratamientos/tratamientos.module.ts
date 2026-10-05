import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Injectable, Module, NotFoundException } from '@nestjs/common';
import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';

export class CreateTratamientoDto {
  @IsString()
  nombre!: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsString()
  especialidadId?: string;

  @IsNumber()
  @Min(0)
  precio!: number;

  @IsOptional()
  @IsNumber()
  @Min(5)
  duracionMin?: number;
}

type Row = Record<string, unknown> & { id: string; tenantId: string };

type Db = {
  tratamiento: {
    findMany: (a: unknown) => Promise<Row[]>;
    findUnique: (a: unknown) => Promise<Row | null>;
    create: (a: unknown) => Promise<Row>;
    update: (a: unknown) => Promise<Row>;
  };
  especialidad: { findUnique: (a: unknown) => Promise<{ tenantId: string } | null> };
};

@Injectable()
export class TratamientosService {
  constructor(private readonly prisma: PrismaService) {}
  private get db(): Db {
    return this.prisma as unknown as Db;
  }

  listar(): Promise<Row[]> {
    requireTenant();
    return this.db.tratamiento.findMany({
      where: { deletedAt: null },
      orderBy: { nombre: 'asc' },
    });
  }

  async obtener(id: string): Promise<Row> {
    const ctx = requireTenant();
    const t = await this.db.tratamiento.findUnique({ where: { id } });
    if (!t || t.tenantId !== ctx.tenantId) throw new NotFoundException('Tratamiento no encontrado');
    return t;
  }

  async crear(dto: CreateTratamientoDto): Promise<Row> {
    const ctx = requireTenant();
    if (dto.especialidadId) {
      const e = await this.db.especialidad.findUnique({ where: { id: dto.especialidadId } });
      if (!e || e.tenantId !== ctx.tenantId) throw new NotFoundException('Especialidad no encontrada');
    }
    return this.db.tratamiento.create({
      data: { ...dto, duracionMin: dto.duracionMin ?? 30, tenantId: ctx.tenantId },
    });
  }

  async actualizar(id: string, dto: Partial<CreateTratamientoDto>): Promise<Row> {
    const ctx = requireTenant();
    await this.obtener(id);
    if (dto.especialidadId) {
      const e = await this.db.especialidad.findUnique({ where: { id: dto.especialidadId } });
      if (!e || e.tenantId !== ctx.tenantId) throw new NotFoundException('Especialidad no encontrada');
    }
    const { tenantId: _ignored, ...resto } = dto as Record<string, unknown>;
    return this.db.tratamiento.update({ where: { id }, data: resto });
  }
}

@Controller('tratamientos')
export class TratamientosController {
  constructor(private readonly service: TratamientosService) {}

  @Get()
  listar(): Promise<unknown> {
    return this.service.listar();
  }

  @Post()
  @RequirePermission('patients.write')
  crear(@Body() dto: CreateTratamientoDto): Promise<unknown> {
    return this.service.crear(dto);
  }

  @Get(':id')
  obtener(@Param('id') id: string): Promise<unknown> {
    return this.service.obtener(id);
  }

  @Patch(':id')
  @RequirePermission('patients.write')
  actualizar(@Param('id') id: string, @Body() dto: Partial<CreateTratamientoDto>): Promise<unknown> {
    return this.service.actualizar(id, dto);
  }
}

@Module({ controllers: [TratamientosController], providers: [TratamientosService] })
export class TratamientosModule {}
