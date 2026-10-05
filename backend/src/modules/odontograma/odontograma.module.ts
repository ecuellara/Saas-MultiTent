import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BadRequestException, Injectable, Module, NotFoundException } from '@nestjs/common';
import { IsArray, IsDateString, IsObject, IsOptional, IsString } from 'class-validator';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';

export class CreateOdontogramaDto {
  @ApiProperty()
  @IsString()
  pacienteId!: string;

  @ApiPropertyOptional({ example: 'inicial' })
  @IsOptional()
  @IsString()
  tipo?: string;

  @ApiProperty()
  @IsDateString()
  fecha!: string;

  @ApiProperty({ example: { '16': { estado: 'caries', superficies: ['O'] } } })
  @IsObject()
  piezas!: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observaciones?: string;
}

export class AddHallazgoDto {
  @ApiProperty({ example: '16' })
  @IsString()
  pieza!: string;

  @ApiProperty({ example: 'CARIES' })
  @IsString()
  hallazgoCodigo!: string;

  @ApiPropertyOptional({ example: ['O'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  superficies?: string[];

  // `estadoClinico` y `color` NO se aceptan del cliente: se derivan del
  // `HallazgoCatalogo` en el servidor (requisito del documento, §6).

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  material?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tratamientoId?: string;

  @ApiPropertyOptional()
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

  async firmar(id: string): Promise<OdontoRow> {
    const ctx = requireTenant();
    const o = await this.obtener(id);
    if (o.estado === 'firmado') throw new BadRequestException('Odontograma ya firmado');
    const db = this.prisma as unknown as {
      odontograma: { update: (a: unknown) => Promise<OdontoRow> };
    };
    // El firmante es SIEMPRE el usuario de la sesión: no se acepta del body
    // (si no, cualquiera con `patients.write` firmaría en nombre de otro).
    return db.odontograma.update({
      where: { id },
      data: { estado: 'firmado', firmadoPor: ctx.userId, firmadoEn: new Date() },
    });
  }

  async agregarHallazgo(id: string, dto: AddHallazgoDto): Promise<unknown> {
    const ctx = requireTenant();
    const o = await this.obtener(id);
    if (o.estado === 'firmado') {
      throw new BadRequestException('Odontograma firmado: solo lectura');
    }
    type Catalogo = {
      activo: boolean;
      colorDefecto: string;
      requiereSuperficie: boolean;
      requiereMaterial: boolean;
      alcance: string;
    };
    const db = this.prisma as unknown as {
      hallazgoCatalogo: { findUnique: (a: unknown) => Promise<Catalogo | null> };
      odontogramaHallazgo: { create: (a: unknown) => Promise<unknown> };
      odontogramaEvento: { create: (a: unknown) => Promise<unknown> };
    };
    const cat = await db.hallazgoCatalogo.findUnique({ where: { codigo: dto.hallazgoCodigo } });
    if (!cat || !cat.activo) throw new NotFoundException('Hallazgo no catalogado');

    // El catálogo manda: superficies y material obligatorios se validan aquí y
    // el color clínico se toma de `colorDefecto`, nunca del cliente.
    const superficies = dto.superficies ?? [];
    if (cat.requiereSuperficie && superficies.length === 0) {
      throw new BadRequestException('Este hallazgo requiere al menos una superficie');
    }
    if (cat.requiereMaterial && !dto.material) {
      throw new BadRequestException('Este hallazgo requiere material');
    }
    if (cat.alcance === 'pieza' && superficies.length > 0) {
      throw new BadRequestException('Este hallazgo es de pieza completa (sin superficies)');
    }

    const hallazgo = await db.odontogramaHallazgo.create({
      data: {
        tenantId: ctx.tenantId,
        odontogramaId: id,
        pieza: dto.pieza,
        hallazgoCodigo: dto.hallazgoCodigo,
        superficies,
        estadoClinico: 'patologico',
        color: cat.colorDefecto,
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
        estadoNuevo: dto.hallazgoCodigo,
        tratamientoId: dto.tratamientoId ?? null,
        citaId: dto.citaId ?? null,
        observacion: `hallazgo ${dto.hallazgoCodigo}`,
      },
    });
    return hallazgo;
  }
}

@ApiTags('odontogramas')
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
  firmar(@Param('id') id: string): Promise<unknown> {
    return this.service.firmar(id);
  }

  @Post(':id/hallazgos')
  @RequirePermission('patients.write')
  hallazgo(@Param('id') id: string, @Body() dto: AddHallazgoDto): Promise<unknown> {
    return this.service.agregarHallazgo(id, dto);
  }
}

@Module({ controllers: [OdontogramaController], providers: [OdontogramaService] })
export class OdontogramaModule {}
