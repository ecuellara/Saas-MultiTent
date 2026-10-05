import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Injectable, Module, NotFoundException } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';

export class CreateEspecialidadDto {
  @IsString()
  nombre!: string;

  @IsOptional()
  @IsString()
  descripcion?: string;
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

  async actualizar(id: string, dto: Partial<CreateEspecialidadDto>): Promise<Row> {
    await this.obtener(id);
    return this.db.especialidad.update({ where: { id }, data: dto });
  }
}

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
  actualizar(@Param('id') id: string, @Body() dto: Partial<CreateEspecialidadDto>): Promise<unknown> {
    return this.service.actualizar(id, dto);
  }
}

@Module({ controllers: [EspecialidadesController], providers: [EspecialidadesService] })
export class EspecialidadesModule {}
