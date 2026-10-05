import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Injectable, Module, NotFoundException } from '@nestjs/common';
import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';

export class CreateTratamientoDto {
  @ApiProperty({ example: 'Limpieza + Profilaxis' })
  @IsString()
  nombre!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  especialidadId?: string;

  @ApiProperty({ example: 120 })
  @IsNumber()
  @Min(0)
  precio!: number;

  @ApiPropertyOptional({ example: 45 })
  @IsOptional()
  @IsNumber()
  @Min(5)
  duracionMin?: number;
}

/**
 * DTO de actualización como CLASE, nunca `Partial<CreateTratamientoDto>`.
 * Un `Partial<T>` hace que `emitDecoratorMetadata` emita `Object` como metatipo
 * y `ValidationPipe.toValidate()` devuelva false: se saltan `whitelist` y
 * `forbidNonWhitelisted` por completo y llegarían a Prisma campos arbitrarios
 * (`precio: -100`, `duracionMin: -5`, `deletedAt`, `id`…).
 */
export class UpdateTratamientoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  especialidadId?: string;

  @ApiPropertyOptional({ example: 120 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  precio?: number;

  @ApiPropertyOptional({ example: 45 })
  @IsOptional()
  @IsNumber()
  @Min(5)
  duracionMin?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
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

  async actualizar(id: string, dto: UpdateTratamientoDto): Promise<Row> {
    const ctx = requireTenant();
    await this.obtener(id);
    if (dto.especialidadId) {
      const e = await this.db.especialidad.findUnique({ where: { id: dto.especialidadId } });
      if (!e || e.tenantId !== ctx.tenantId) throw new NotFoundException('Especialidad no encontrada');
    }
    // Allowlist explícita: nunca `data: dto` (evita mass assignment).
    const data: Record<string, unknown> = {};
    if (dto.nombre !== undefined) data.nombre = dto.nombre;
    if (dto.descripcion !== undefined) data.descripcion = dto.descripcion;
    if (dto.especialidadId !== undefined) data.especialidadId = dto.especialidadId;
    if (dto.precio !== undefined) data.precio = dto.precio;
    if (dto.duracionMin !== undefined) data.duracionMin = dto.duracionMin;
    if (dto.activo !== undefined) data.activo = dto.activo;
    return this.db.tratamiento.update({ where: { id }, data });
  }
}

@ApiTags('tratamientos')
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
  actualizar(@Param('id') id: string, @Body() dto: UpdateTratamientoDto): Promise<unknown> {
    return this.service.actualizar(id, dto);
  }
}

@Module({ controllers: [TratamientosController], providers: [TratamientosService] })
export class TratamientosModule {}
