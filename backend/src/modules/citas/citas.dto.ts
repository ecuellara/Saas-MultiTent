import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const FECHA_CIVIL = /^\d{4}-\d{2}-\d{2}$/;

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
  @IsDateString()
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
  @IsDateString()
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
  fecha?: string;

  @ApiPropertyOptional({ example: '2026-03-01' })
  @IsOptional()
  @Matches(FECHA_CIVIL, { message: 'desde debe ser aaaa-mm-dd' })
  desde?: string;

  @ApiPropertyOptional({ example: '2026-03-31' })
  @IsOptional()
  @Matches(FECHA_CIVIL, { message: 'hasta debe ser aaaa-mm-dd' })
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
  @Min(15)
  @Max(480)
  duracion!: number;
}
