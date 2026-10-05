import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Injectable, Module, NotFoundException } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';

export class CreateEspecialidadDto {
  @ApiProperty({ example: 'Odontología General' })
  @IsString()
  nombre!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descripcion?: string;
}

/**
 * DTO de actualización como CLASE, no `Partial<CreateEspecialidadDto>`.
 * Un `Partial<T>`/intersección/type-literal hace que `emitDecoratorMetadata`
 * emita `Object` como metatipo y `ValidationPipe.toValidate()` devuelva false:
 * se saltan `whitelist` y `forbidNonWhitelisted` por completo, y un body con
 * `{"tenantId": "<otro tenant>"}` llegaría crudo a Prisma (mass assignment).
 */
export class UpdateEspecialidadDto {
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
  @IsBoolean()
  activo?: boolean;
}

type Row = Record<string, unknown> & { id: string; tenantId: string };

type Db = {
  especialidad: {
    findMany: (a: unknown) => Promise<Row[]>;
    findUnique: (a: unknown) => Promise<Row | null>;
    create: (a: unknown) => Promise<Row>;
    update: (a: unknown) => Promise<Row>;
  };
};

@Injectable()
export class EspecialidadesService {
  constructor(private readonly prisma: PrismaService) {}
  private get db(): Db {
    return this.prisma as unknown as Db;
  }

  listar(): Promise<Row[]> {
    requireTenant();
    return this.db.especialidad.findMany({ orderBy: { nombre: 'asc' } });
  }

  async obtener(id: string): Promise<Row> {
    const ctx = requireTenant();
    const e = await this.db.especialidad.findUnique({ where: { id } });
    if (!e || e.tenantId !== ctx.tenantId) throw new NotFoundException('Especialidad no encontrada');
    return e;
  }

  crear(dto: CreateEspecialidadDto): Promise<Row> {
    const ctx = requireTenant();
    return this.db.especialidad.create({ data: { ...dto, tenantId: ctx.tenantId } });
  }

  async actualizar(id: string, dto: UpdateEspecialidadDto): Promise<Row> {
    await this.obtener(id);
    // Allowlist explícita: nunca `data: dto` (evita mass assignment de tenantId).
    const data: { nombre?: string; descripcion?: string; activo?: boolean } = {};
    if (dto.nombre !== undefined) data.nombre = dto.nombre;
    if (dto.descripcion !== undefined) data.descripcion = dto.descripcion;
    if (dto.activo !== undefined) data.activo = dto.activo;
    return this.db.especialidad.update({ where: { id }, data });
  }
}

@ApiTags('especialidades')
@Controller('especialidades')
export class EspecialidadesController {
  constructor(private readonly service: EspecialidadesService) {}

  @Get()
  listar(): Promise<unknown> {
    return this.service.listar();
  }

  @Post()
  @RequirePermission('patients.write')
  crear(@Body() dto: CreateEspecialidadDto): Promise<unknown> {
    return this.service.crear(dto);
  }

  @Get(':id')
  obtener(@Param('id') id: string): Promise<unknown> {
    return this.service.obtener(id);
  }

  @Patch(':id')
  @RequirePermission('patients.write')
  actualizar(@Param('id') id: string, @Body() dto: UpdateEspecialidadDto): Promise<unknown> {
    return this.service.actualizar(id, dto);
  }
}

@Module({ controllers: [EspecialidadesController], providers: [EspecialidadesService] })
export class EspecialidadesModule {}
