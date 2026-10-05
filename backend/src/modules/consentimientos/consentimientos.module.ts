import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BadRequestException, Injectable, Module, NotFoundException } from '@nestjs/common';
import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';

/**
 * DTO del body de `PATCH /consentimientos/:id/estado` como CLASE normal, nunca
 * una intersección (`EstadoConsentimientoDto & { revocadoPor?: string }`).
 * Un tipo intersección hace que `emitDecoratorMetadata` emita `Object` como
 * metatipo y `ValidationPipe.toValidate()` devuelva false: se saltarían
 * `whitelist` y `forbidNonWhitelisted`, y el cliente podría inyectar
 * `revocadoPor` para atribuirse (o atribuir a otro) la revocación de un
 * consentimiento informado. La autoría sale SIEMPRE de `ctx.userId`.
 */
export class EstadoConsentimientoDto {
  @ApiProperty({ enum: ['borrador', 'firmado', 'revocado', 'anulado'] })
  @IsString()
  @IsIn(['borrador', 'firmado', 'revocado', 'anulado'])
  estado!: string;
}

export class CreatePlantillaDto {
  @ApiProperty({ example: 'endodoncia' })
  @IsString()
  clave!: string;

  @ApiProperty()
  @IsString()
  titulo!: string;

  @ApiProperty()
  @IsString()
  cuerpo!: string;
}

export class CreateConsentimientoDto {
  @ApiProperty()
  @IsString()
  pacienteId!: string;

  @ApiProperty()
  @IsString()
  plantillaId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  citaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tratamiento?: string;

  @ApiProperty()
  @IsObject()
  datosSnapshot!: Record<string, unknown>;
}

type FirmadoRow = Record<string, unknown> & {
  id: string;
  tenantId: string;
  estado: string;
};

type PacienteRow = {
  tenantId: string;
  fechaNac: Date | string | null;
  representanteNombre: string | null;
  representanteDni: string | null;
};

type Db = {
  consentimientoFirmado: {
    findUnique: (a: unknown) => Promise<FirmadoRow | null>;
    findMany: (a: unknown) => Promise<FirmadoRow[]>;
    create: (a: unknown) => Promise<FirmadoRow>;
    update: (a: unknown) => Promise<FirmadoRow>;
  };
  consentimientoPlantilla: {
    findMany: (a: unknown) => Promise<unknown>;
    findUnique: (a: unknown) => Promise<Record<string, unknown> | null>;
    create: (a: unknown) => Promise<unknown>;
  };
  paciente: { findUnique: (a: unknown) => Promise<PacienteRow | null> };
};

/** Mayoría de edad legal (Perú): 18 años cumplidos. */
const MAYORIA_DE_EDAD = 18;

/**
 * Edad en años cumplidos a la fecha de referencia. Se calcula con
 * componentes de fecha **locales** (misma convención que el resto del
 * backend, que usa `new Date(...)` local para columnas `@db.Date`), así que un
 * `fechaNac` con hora no desplaza el resultado por zona horaria.
 * Devuelve `null` si no hay fecha de nacimiento (dato desconocido).
 */
export function calcularEdad(
  fechaNac: Date | string | null | undefined,
  hoy = new Date(),
): number | null {
  if (!fechaNac) return null;
  const n = new Date(fechaNac);
  if (Number.isNaN(n.getTime())) return null;
  let edad = hoy.getFullYear() - n.getFullYear();
  const mes = hoy.getMonth() - n.getMonth();
  if (mes < 0 || (mes === 0 && hoy.getDate() < n.getDate())) edad -= 1;
  return edad;
}

/**
 * Consentimientos (doc §6): `cuerpoSnapshot` congela el texto al firmar;
 * revocación con trazabilidad (`revocadoEn/revocadoPor`).
 * Transiciones: borrador→firmado→revocado; anulado solo desde borrador.
 */
@Injectable()
export class ConsentimientosService {
  constructor(private readonly prisma: PrismaService) {}
  private get db(): Db {
    return this.prisma as unknown as Db;
  }

  async obtener(id: string): Promise<FirmadoRow> {
    const ctx = requireTenant();
    const c = await this.db.consentimientoFirmado.findUnique({ where: { id } });
    if (!c || c.tenantId !== ctx.tenantId) {
      throw new NotFoundException('Consentimiento no encontrado');
    }
    return c;
  }

  async plantillas(): Promise<unknown> {
    requireTenant();
    return this.db.consentimientoPlantilla.findMany({ orderBy: { clave: 'asc' } });
  }

  async crearPlantilla(dto: CreatePlantillaDto): Promise<unknown> {
    const ctx = requireTenant();
    return this.db.consentimientoPlantilla.create({
      data: { ...dto, tenantId: ctx.tenantId },
    });
  }

  async crear(dto: CreateConsentimientoDto): Promise<FirmadoRow> {
    const ctx = requireTenant();
    const p = await this.db.paciente.findUnique({ where: { id: dto.pacienteId } });
    if (!p || p.tenantId !== ctx.tenantId) throw new NotFoundException('Paciente no encontrado');
    // Consentimiento informado de un MENOR: exige representante legal (doc §6).
    // Si no hay `fechaNac` la edad es desconocida y no se bloquea.
    const edad = calcularEdad(p.fechaNac);
    if (edad !== null && edad < MAYORIA_DE_EDAD) {
      const nombre = (p.representanteNombre ?? '').trim();
      const dni = (p.representanteDni ?? '').trim();
      if (!nombre || !dni) {
        throw new BadRequestException(
          'El paciente es menor de edad: se requiere representanteNombre y representanteDni',
        );
      }
    }
    const plantilla = await this.db.consentimientoPlantilla.findUnique({
      where: { id: dto.plantillaId },
    });
    if (!plantilla || (plantilla.tenantId as string) !== ctx.tenantId) {
      throw new NotFoundException('Plantilla no encontrada');
    }
    return this.db.consentimientoFirmado.create({
      data: {
        tenantId: ctx.tenantId,
        pacienteId: dto.pacienteId,
        plantillaId: dto.plantillaId,
        citaId: dto.citaId ?? null,
        tratamiento: dto.tratamiento ?? null,
        datosSnapshot: dto.datosSnapshot,
        // Congela el texto vigente al momento de crear/firmar.
        cuerpoSnapshot: plantilla.cuerpo as string,
        estado: 'borrador',
      },
    });
  }

  /**
   * Transición de estado. La autoría de la revocación sale SIEMPRE de
   * `ctx.userId` (nunca del body) y la fecha del reloj del servidor.
   */
  async cambiarEstado(id: string, estado: string): Promise<FirmadoRow> {
    const actual = await this.obtener(id);
    const desde = actual.estado;
    const permitidas: Record<string, string[]> = {
      borrador: ['firmado', 'anulado'],
      firmado: ['revocado'],
      revocado: [],
      anulado: [],
    };
    if (!permitidas[desde]?.includes(estado)) {
      throw new BadRequestException(`Transición ${desde}→${estado} no permitida`);
    }
    const ctx = requireTenant();
    return this.db.consentimientoFirmado.update({
      where: { id },
      data: {
        estado,
        ...(estado === 'firmado' ? { firmadoEn: new Date() } : {}),
        ...(estado === 'revocado' ? { revocadoEn: new Date(), revocadoPor: ctx.userId } : {}),
      },
    });
  }
}

@ApiTags('consentimientos')
@Controller('consentimientos')
export class ConsentimientosController {
  constructor(private readonly service: ConsentimientosService) {}

  @Get('plantillas')
  @RequirePermission('consents.read')
  plantillas(): Promise<unknown> {
    return this.service.plantillas();
  }

  @Post('plantillas')
  @RequirePermission('consents.write')
  crearPlantilla(@Body() dto: CreatePlantillaDto): Promise<unknown> {
    return this.service.crearPlantilla(dto);
  }

  @Post()
  @RequirePermission('consents.write')
  crear(@Body() dto: CreateConsentimientoDto): Promise<unknown> {
    return this.service.crear(dto);
  }

  @Get(':id')
  @RequirePermission('consents.read')
  obtener(@Param('id') id: string): Promise<unknown> {
    return this.service.obtener(id);
  }

  @Patch(':id/estado')
  @RequirePermission('consents.write')
  cambiarEstado(
    @Param('id') id: string,
    @Body() dto: EstadoConsentimientoDto,
  ): Promise<unknown> {
    return this.service.cambiarEstado(id, dto.estado);
  }
}

@Module({ controllers: [ConsentimientosController], providers: [ConsentimientosService] })
export class ConsentimientosModule {}
