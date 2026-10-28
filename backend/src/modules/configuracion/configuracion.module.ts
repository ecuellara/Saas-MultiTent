import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Injectable, Module, NotFoundException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  IsArray,
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  type ArchivoSubido,
  BrandingService,
  LOGO_MAX_BYTES,
} from '../../core/branding/branding.service.js';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function aMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

/** Fecha civil real `YYYY-MM-DD` (rechaza `2026-13-45`, no solo el formato). */
function esFechaCivil(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Validadores cruzados como decoradores DE PROPIEDAD (`@Validate` solo existe
 * en esa forma en el class-validator instalado; `@Validate(...)` sobre la
 * clase no resuelve su firma). Cada uno corre sobre la propiedad dependiente,
 * que es justo cuando hace falta comprobarla:
 * - `fin` siempre viene (requerido) → orden inicio<fin siempre comprobado.
 * - `hasta` solo se comprueba si viene (sin `hasta` el descanso es de un día).
 * - `desde` siempre viene → fecha real comprobada.
 * La única regla que no cabe en una propiedad (las 7 claves presentes, aunque
 * falte la propia `dom`) la comprueba el servicio con 400 (ver `actualizar`).
 */
@ValidatorConstraint({ name: 'FinPosteriorAInicio', async: false })
class FinPosteriorAInicio implements ValidatorConstraintInterface {
  validate(fin: unknown, args: ValidationArguments): boolean {
    const o = args.object as { inicio?: unknown };
    return (
      typeof fin === 'string' &&
      typeof o.inicio === 'string' &&
      HORA.test(o.inicio) &&
      HORA.test(fin) &&
      aMinutos(fin) > aMinutos(o.inicio)
    );
  }

  defaultMessage(): string {
    return 'fin debe ser posterior a inicio (HH:MM de 24 h con cero delante)';
  }
}

@ValidatorConstraint({ name: 'FechaCivilReal', async: false })
class FechaCivilReal implements ValidatorConstraintInterface {
  validate(v: unknown): boolean {
    return esFechaCivil(v);
  }

  defaultMessage(): string {
    return 'debe ser una fecha civil real YYYY-MM-DD';
  }
}

@ValidatorConstraint({ name: 'HastaNoAnteriorADesde', async: false })
class HastaNoAnteriorADesde implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    // OJO: el primer parámetro sería el valor de `desde` (la propiedad
    // decorada); `hasta` se lee del objeto.
    const o = args.object as { desde?: unknown; hasta?: unknown };
    if (o.hasta === undefined || o.hasta === null) return true;
    return (
      esFechaCivil(o.hasta) && esFechaCivil(o.desde) && (o.hasta as string) >= (o.desde as string)
    );
  }

  defaultMessage(): string {
    return 'hasta debe ser YYYY-MM-DD real y >= desde';
  }
}

export class HorarioDiaDto {
  @ApiProperty({ example: '09:00' })
  @IsString()
  @Matches(HORA, { message: 'inicio debe ser HH:MM de 24 h con cero delante' })
  inicio!: string;

  @ApiProperty({ example: '19:00' })
  @IsString()
  @Matches(HORA, { message: 'fin debe ser HH:MM de 24 h con cero delante' })
  @Validate(FinPosteriorAInicio)
  fin!: string;
}

/**
 * Horario semanal. Claves EXACTAS `dom..sab` (`mie`, no `mié` ni `wed`): las
 * que entiende `CitasService`. Cada día es franja u `null` (cerrado); un día
 * omitido equivale a cerrado (el lector trata igual `undefined` y `null`) y
 * una clave mal escrita la rechaza el whitelist con 400.
 */
export class HorarioDto {
  // Cada día es OBLIGATORIO pero anulable: `@IsOptional()` deja pasar el
  // `null` de día cerrado (sin él, `ValidateNested` lo rechaza) y la
  // presencia de las 7 claves la exige el servicio (un decorador de
  // propiedad no corre si su clave falta).
  // `@IsObject()` en cada nivel: sin él, un texto o un array se transforma
  // en instancia vacía y pasa como válido, dejando una regla muerta.
  @ApiPropertyOptional({ example: null })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => HorarioDiaDto)
  dom!: HorarioDiaDto | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => HorarioDiaDto)
  lun!: HorarioDiaDto | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => HorarioDiaDto)
  mar!: HorarioDiaDto | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => HorarioDiaDto)
  mie!: HorarioDiaDto | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => HorarioDiaDto)
  jue!: HorarioDiaDto | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => HorarioDiaDto)
  vie!: HorarioDiaDto | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => HorarioDiaDto)
  sab!: HorarioDiaDto | null;
}

export class DescansoDto {
  @ApiProperty({ example: '2026-12-25' })
  @IsString()
  @Validate(FechaCivilReal)
  @Validate(HastaNoAnteriorADesde)
  desde!: string;

  @ApiPropertyOptional({ example: '2026-12-26' })
  @IsOptional()
  @IsString()
  hasta?: string;

  @ApiPropertyOptional({ example: 'Navidad' })
  @IsOptional()
  @IsString()
  motivo?: string;
}

/**
 * Colores de marca de la clínica. Se exigen ambos porque la interfaz siempre
 * envía el par completo; el valor debe ser un hex CSS `#RRGGBB`.
 */
export class ColoresDto {
  @ApiProperty({ example: '#0756a3' })
  @IsString()
  @Matches(HEX_COLOR, { message: 'colores.primario debe ser un color hex #RRGGBB' })
  primario!: string;

  @ApiProperty({ example: '#12b8ce' })
  @IsString()
  @Matches(HEX_COLOR, { message: 'colores.acento debe ser un color hex #RRGGBB' })
  acento!: string;
}

export class UpdateConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ruc?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  direccion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  telefono?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ciudad?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiPropertyOptional({ type: ColoresDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ColoresDto)
  colores?: ColoresDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => HorarioDto)
  horario?: HorarioDto | null;

  @ApiPropertyOptional({ type: [DescansoDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DescansoDto)
  descansos?: DescansoDto[];
}

type ConfigRow = Record<string, unknown> & { tenantId: string };

const SELECT_CONFIG = {
  tenantId: true,
  nombre: true,
  ruc: true,
  direccion: true,
  telefono: true,
  email: true,
  ciudad: true,
  horario: true,
  descansos: true,
  logoUrl: true,
  colores: true,
  updatedAt: true,
} as const;

@Injectable()
export class ConfiguracionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branding: BrandingService,
  ) {}

  private get db(): {
    tenantConfig: {
      findUnique: (a: unknown) => Promise<ConfigRow | null>;
      update: (a: unknown) => Promise<ConfigRow>;
      create: (a: unknown) => Promise<ConfigRow>;
      upsert: (a: unknown) => Promise<ConfigRow>;
    };
  } {
    return this.prisma as unknown as ConfiguracionService['db'];
  }

  /**
   * Lectura SIN permiso de gestión (política): el horario y los datos de la
   * clínica salen en los documentos que imprime cualquier operador.
   */
  async obtener(): Promise<ConfigRow> {
    const ctx = requireTenant();
    const cfg = await this.db.tenantConfig.findUnique({
      where: { tenantId: ctx.tenantId },
      select: { ...SELECT_CONFIG },
    });
    if (!cfg) throw new NotFoundException('Configuración no encontrada');
    return cfg;
  }

  /**
   * Actualización PARCIAL con `upsert`: solo se escriben las claves presentes.
   * Un PATCH sin `ciudad` NO la toca (nunca se reasigna el default del esquema
   * aquí). El `tenantId` sale del contexto; si viene en el cuerpo, el
   * `forbidNonWhitelisted` lo rechaza con 400 (invariante 1).
   */
  async actualizar(dto: UpdateConfigDto): Promise<ConfigRow> {
    const ctx = requireTenant();
    // NOTA sobre claves ausentes: class-transformer materializa las 7
    // propiedades decoradas (las ausentes como `undefined`), así que aquí ya
    // no se distingue "omitida" de nada. No importa: el lector trata
    // `undefined` igual que `null` (día cerrado, observable en la respuesta),
    // y una clave MAL ESCRITA (`mier`) la rechaza el `forbidNonWhitelisted`
    // con 400 antes de llegar aquí.
    const data: Record<string, unknown> = {};
    for (const k of [
      'nombre',
      'ruc',
      'direccion',
      'telefono',
      'email',
      'ciudad',
      'logoUrl',
      'horario',
      'descansos',
    ] as const) {
      if (dto[k] !== undefined) data[k] = dto[k];
    }
    if (dto.colores !== undefined) {
      data.colores = dto.colores
        ? { primario: dto.colores.primario, acento: dto.colores.acento }
        : null;
    }
    return this.db.tenantConfig.upsert({
      where: { tenantId: ctx.tenantId },
      update: data,
      create: { tenantId: ctx.tenantId, ...data },
      select: { ...SELECT_CONFIG },
    } as unknown as Parameters<ConfiguracionService['db']['tenantConfig']['update']>[0]);
  }

  /** Sube/reemplaza el logo del tenant autenticado y devuelve la configuración. */
  async subirLogo(archivo: ArchivoSubido | undefined): Promise<ConfigRow> {
    const ctx = requireTenant();
    await this.branding.subirLogo(ctx.tenantId, archivo);
    return this.obtener();
  }

  /** Elimina el logo del tenant autenticado y devuelve la configuración. */
  async quitarLogo(): Promise<ConfigRow> {
    const ctx = requireTenant();
    await this.branding.quitarLogo(ctx.tenantId);
    return this.obtener();
  }
}

@ApiTags('configuracion')
@Controller('configuracion')
export class ConfiguracionController {
  constructor(private readonly service: ConfiguracionService) {}

  @Get()
  obtener(): Promise<unknown> {
    return this.service.obtener();
  }

  @Patch()
  @RequirePermission('sedes.manage')
  actualizar(@Body() dto: UpdateConfigDto): Promise<unknown> {
    return this.service.actualizar(dto);
  }

  /**
   * Logo de la clínica. `archivo` es obligatorio; el tipo real se decide por
   * magic bytes (`firmarMime`), no por el nombre ni el MIME declarado.
   */
  @Post('logo')
  @RequirePermission('sedes.manage')
  @UseInterceptors(
    FileInterceptor('archivo', {
      limits: { fileSize: LOGO_MAX_BYTES, files: 1 },
    }),
  )
  subirLogo(@UploadedFile() archivo: ArchivoSubido | undefined): Promise<unknown> {
    return this.service.subirLogo(archivo);
  }

  @Delete('logo')
  @RequirePermission('sedes.manage')
  quitarLogo(): Promise<unknown> {
    return this.service.quitarLogo();
  }
}

@Module({ controllers: [ConfiguracionController], providers: [ConfiguracionService] })
export class ConfiguracionModule {}
