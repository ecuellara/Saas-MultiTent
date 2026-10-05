import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Injectable, Module, NotFoundException } from '@nestjs/common';
import { IsDateString, IsOptional, IsString } from 'class-validator';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';

export class CreateHistorialDto {
  @IsString()
  pacienteId!: string;

  @IsOptional()
  @IsString()
  citaId?: string;

  @IsDateString()
  fecha!: string;

  @IsOptional()
  @IsString()
  hora?: string;

  @IsString()
  motivo!: string;

  @IsOptional()
  @IsString()
  sintomas?: string;

  @IsOptional()
  @IsString()
  diagnostico?: string;

  @IsOptional()
  @IsString()
  tratamientoRealizado?: string;

  @IsOptional()
  @IsString()
  prescripcion?: string;
}

type Db = {
  historialClinico: {
    findMany: (a: unknown) => Promise<unknown>;
    create: (a: unknown) => Promise<unknown>;
  };
  paciente: { findUnique: (a: unknown) => Promise<{ tenantId: string } | null> };
  cita: { findUnique: (a: unknown) => Promise<{ tenantId: string } | null> };
};

@Injectable()
export class HistorialesService {
  constructor(private readonly prisma: PrismaService) {}
  private get db(): Db {
    return this.prisma as unknown as Db;
  }

  async listar(pacienteId: string): Promise<unknown> {
    const ctx = requireTenant();
    const p = await this.db.paciente.findUnique({ where: { id: pacienteId } });
    if (!p || p.tenantId !== ctx.tenantId) throw new NotFoundException('Paciente no encontrado');
    return this.db.historialClinico.findMany({
      where: { pacienteId },
      orderBy: [{ fecha: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async crear(dto: CreateHistorialDto): Promise<unknown> {
    const ctx = requireTenant();
    const p = await this.db.paciente.findUnique({ where: { id: dto.pacienteId } });
    if (!p || p.tenantId !== ctx.tenantId) throw new NotFoundException('Paciente no encontrado');
    if (dto.citaId) {
      const c = await this.db.cita.findUnique({ where: { id: dto.citaId } });
      if (!c || c.tenantId !== ctx.tenantId) throw new NotFoundException('Cita no encontrada');
    }
    return this.db.historialClinico.create({
      data: {
        tenantId: ctx.tenantId,
        pacienteId: dto.pacienteId,
        citaId: dto.citaId ?? null,
        fecha: new Date(dto.fecha),
        hora: dto.hora ?? null,
        motivo: dto.motivo,
        sintomas: dto.sintomas ?? null,
        diagnostico: dto.diagnostico ?? null,
        tratamientoRealizado: dto.tratamientoRealizado ?? null,
        prescripcion: dto.prescripcion ?? null,
      },
    });
  }
}

@Controller('historiales')
export class HistorialesController {
  constructor(private readonly service: HistorialesService) {}

  @Get()
  listar(@Query('pacienteId') pacienteId: string): Promise<unknown> {
    return this.service.listar(pacienteId);
  }

  @Post()
  @RequirePermission('patients.write')
  crear(@Body() dto: CreateHistorialDto): Promise<unknown> {
    return this.service.crear(dto);
  }
}

@Module({ controllers: [HistorialesController], providers: [HistorialesService] })
export class HistorialesModule {}
