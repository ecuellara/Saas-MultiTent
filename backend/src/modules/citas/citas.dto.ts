import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min, Validate, ValidatorConstraint, type ValidatorConstraintInterface } from 'class-validator';
import { Type } from 'class-transformer';
import { esFechaCivil, esFechaCivilOMedianocheUtc } from '../../core/fecha-civil.js';

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const FECHA_CIVIL = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `@IsDateString()` acepta instantes con hora/offset y fechas imposibles
 * (`2026-02-30`): ambas se normalizan a otro día al guardar. El dominio es una
 * fecha civil, así que se valida el día exacto.
 */
@ValidatorConstraint({ name: 'FechaCivilReal', async: false })
class FechaCivilReal implements ValidatorConstraintInterface {
  validate(v: unknown): boolean {
    return esFechaCivil(v);
  }

  defaultMessage(): string {
    return 'debe ser una fecha civil real aaaa-mm-dd (sin hora)';
  }
}

/** Cuerpo de la cita: admite además la medianoche UTC que enviaba el frontend anterior. */
@ValidatorConstraint({ name: 'FechaCivilAceptaLegacy', async: false })
class FechaCivilAceptaLegacy implements ValidatorConstraintInterface {
  validate(v: unknown): boolean {
    return esFechaCivilOMedianocheUtc(v);
  }

  defaultMessage(): string {
    return 'debe ser una fecha civil real aaaa-mm-dd (o su medianoche UTC heredada)';
  }
}

export class CreateCitaDto {
  @ApiProperty()
  @IsString()
  pacienteId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tratamientoId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dentistaId?: string;

  @ApiProperty({ example: '2026-03-10' })
  @Validate(FechaCivilAceptaLegacy)
  fecha!: string;

  @ApiProperty({ example: '09:00' })
  @Matches(HORA, { message: 'horaInicio debe ser HH:MM' })
  horaInicio!: string;

  @ApiProperty({ example: '09:30' })
  @Matches(HORA, { message: 'horaFin debe ser HH:MM' })
  horaFin!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observacion?: string;
}

export class UpdateCitaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Validate(FechaCivilAceptaLegacy)
  fecha?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(HORA, { message: 'horaInicio debe ser HH:MM' })
  horaInicio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(HORA, { message: 'horaFin debe ser HH:MM' })
  horaFin?: string;

  @ApiPropertyOptional({
    enum: ['pendiente', 'confirmada', 'recordatorio_enviado', 'reprogramada', 'cancelada', 'realizada', 'no_asistio'],
  })
  @IsOptional()
  @IsIn(['pendiente', 'confirmada', 'recordatorio_enviado', 'reprogramada', 'cancelada', 'realizada', 'no_asistio'])
  estado?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observacion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tratamientoId?: string;
}

/**
 * Filtros de `GET /citas`: un día (`fecha`), un rango (`desde`/`hasta`,
 * máximo 62 días para no traerse la clínica entera) y alcances opcionales
 * (sede, odontólogo, estado). Sin nada, devuelve todas (comportamiento actual).
 */
export class ListarCitasQuery {
  @ApiPropertyOptional({ example: '2026-03-10' })
  @IsOptional()
  @Matches(FECHA_CIVIL, { message: 'fecha debe ser aaaa-mm-dd' })
  @Validate(FechaCivilReal)
  fecha?: string;

  @ApiPropertyOptional({ example: '2026-03-01' })
  @IsOptional()
  @Matches(FECHA_CIVIL, { message: 'desde debe ser aaaa-mm-dd' })
  @Validate(FechaCivilReal)
  desde?: string;

  @ApiPropertyOptional({ example: '2026-03-31' })
  @IsOptional()
  @Matches(FECHA_CIVIL, { message: 'hasta debe ser aaaa-mm-dd' })
  @Validate(FechaCivilReal)
  hasta?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dentistaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  estado?: string;
}

/** Parámetros de `GET /citas/disponibilidad`: rejilla de 15 minutos. */
export class DisponibilidadQuery {
  @ApiProperty({ example: '2026-03-10' })
  @Matches(FECHA_CIVIL, { message: 'fecha debe ser aaaa-mm-dd' })
  @Validate(FechaCivilReal)
  fecha!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dentistaId?: string;

  @ApiProperty({ example: 30 })
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(1440)
  duracion!: number;
}
