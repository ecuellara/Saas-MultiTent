import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { BadRequestException, Injectable, Module, NotFoundException } from '@nestjs/common';
import { IsDateString, IsObject, IsOptional, IsString } from 'class-validator';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';

export class CreateOdontogramaDto {
  @IsString()
  pacienteId!: string;

  @IsOptional()
  @IsString()
  tipo?: string;

  @IsDateString()
  fecha!: string;

  @IsObject()
  piezas!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  observaciones?: string;
}

export class AddHallazgoDto {
  @IsString()
  pieza!: string;

  @IsString()
  hallazgoCodigo!: string;

  @IsOptional()
  superficies?: string[];

  @IsString()
  estadoClinico!: string;

  @IsString()
  color!: string;

  @IsOptional()
  @IsString()
  material?: string;

  @IsOptional()
  @IsString()
  tratamientoId?: string;

  @IsOptional()
  @IsString()
  citaId?: string;
}

type OdontoRow = Record<string, unknown> & {
  id: string;
  tenantId: string;
  pacienteId: string;
  version: number;
  estado: string;
};

/**
 * Odontograma NTS 188 versionado (doc §6).
 * - Versión atómica por paciente: `@@unique([tenantId, pacienteId, version])`.
 * - Bloqueo por firma: firmado → solo lectura ("anular ≠ borrar").
 */
@Injectable()
export class OdontogramaService {
  constructor(private readonly prisma: PrismaService) {}

  async crear(dto: CreateOdontogramaDto): Promise<OdontoRow> {
    const ctx = requireTenant();
    const db = this.prisma as unknown as {
      paciente: { findUnique: (a: unknown) => Promise<{ tenantId: string } | null> };
      odontograma: {
        findMany: (a: unknown) => Promise<OdontoRow[]>;
        findUnique: (a: unknown) => Promise<OdontoRow | null>;
        create: (a: unknown) => Promise<OdontoRow>;
        update: (a: unknown) => Promise<OdontoRow>;
      };
    };
    const p = await db.paciente.findUnique({ where: { id: dto.pacienteId } });
    if (!p || p.tenantId !== ctx.tenantId) throw new NotFoundException('Paciente no encontrado');

    // Versión siguiente = max + 1 dentro de transacción para evitar carreras.
    return this.prisma.$transaction(async (tx) => {
      const t = tx as unknown as {
        odontograma: {
          findMany: (a: unknown) => Promise<OdontoRow[]>;
          create: (a: unknown) => Promise<OdontoRow>;
        };
      };
      const previas = await t.odontograma.findMany({
        where: { tenantId: ctx.tenantId, pacienteId: dto.pacienteId },
        orderBy: { version: 'desc' },
        take: 1,
      });
      const version = previas.length ? previas[0].version + 1 : 1;
      return t.odontograma.create({
        data: {
          tenantId: ctx.tenantId,
          pacienteId: dto.pacienteId,
          tipo: dto.tipo ?? 'inicial',
          version,
          estado: 'borrador',
          piezas: dto.piezas,
          observaciones: dto.observaciones ?? null,
          fecha: new Date(dto.fecha),
        },
      });
    });
  }

  async obtener(id: string): Promise<OdontoRow> {
    const ctx = requireTenant();
    const db = this.prisma as unknown as {
      odontograma: {
        findUnique: (a: unknown) => Promise<OdontoRow | null>;
      };
    };
    const o = await db.odontograma.findUnique({
      where: { id },
      include: { hallazgos: true, eventos: true },
    } as unknown as object);
    if (!o || o.tenantId !== ctx.tenantId) throw new NotFoundException('Odontograma no encontrado');
    return o;
  }

  async firmar(id: string, firmadoPor: string): Promise<OdontoRow> {
    const o = await this.obtener(id);
    if (o.estado === 'firmado') throw new BadRequestException('Odontograma ya firmado');
    const db = this.prisma as unknown as {
      odontograma: { update: (a: unknown) => Promise<OdontoRow> };
    };
    return db.odontograma.update({
      where: { id },
      data: { estado: 'firmado', firmadoPor, firmadoEn: new Date() },
    });
  }

  async agregarHallazgo(id: string, dto: AddHallazgoDto): Promise<unknown> {
    const ctx = requireTenant();
    const o = await this.obtener(id);
    if (o.estado === 'firmado') {
      throw new BadRequestException('Odontograma firmado: solo lectura');
    }
    const db = this.prisma as unknown as {
      hallazgoCatalogo: { findUnique: (a: unknown) => Promise<unknown | null> };
      odontogramaHallazgo: { create: (a: unknown) => Promise<unknown> };
      odontogramaEvento: { create: (a: unknown) => Promise<unknown> };
    };
    const cat = await db.hallazgoCatalogo.findUnique({ where: { codigo: dto.hallazgoCodigo } });
    if (!cat) throw new NotFoundException('Hallazgo no catalogado');
    const hallazgo = await db.odontogramaHallazgo.create({
      data: {
        tenantId: ctx.tenantId,
        odontogramaId: id,
        pieza: dto.pieza,
        hallazgoCodigo: dto.hallazgoCodigo,
        superficies: dto.superficies ?? [],
        estadoClinico: dto.estadoClinico,
        color: dto.color,
        material: dto.material ?? null,
        tratamientoId: dto.tratamientoId ?? null,
        citaId: dto.citaId ?? null,
      },
    });
    await db.odontogramaEvento.create({
      data: {
        tenantId: ctx.tenantId,
        odontogramaId: id,
        pieza: dto.pieza,
        estadoNuevo: dto.estadoClinico,
        tratamientoId: dto.tratamientoId ?? null,
        citaId: dto.citaId ?? null,
        observacion: `hallazgo ${dto.hallazgoCodigo}`,
      },
    });
    return hallazgo;
  }
}

@Controller('odontogramas')
export class OdontogramaController {
  constructor(private readonly service: OdontogramaService) {}

  @Post()
  @RequirePermission('patients.write')
  crear(@Body() dto: CreateOdontogramaDto): Promise<unknown> {
    return this.service.crear(dto);
  }

  @Get(':id')
  obtener(@Param('id') id: string): Promise<unknown> {
    return this.service.obtener(id);
  }

  @Patch(':id/firmar')
  @RequirePermission('patients.write')
  firmar(@Param('id') id: string, @Body() body: { firmadoPor: string }): Promise<unknown> {
    return this.service.firmar(id, body.firmadoPor);
  }

  @Post(':id/hallazgos')
  @RequirePermission('patients.write')
  hallazgo(@Param('id') id: string, @Body() dto: AddHallazgoDto): Promise<unknown> {
    return this.service.agregarHallazgo(id, dto);
  }
}

@Module({ controllers: [OdontogramaController], providers: [OdontogramaService] })
export class OdontogramaModule {}
