import { IsDateString, IsIn, IsOptional, IsString, Matches } from 'class-validator';

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateCitaDto {
  @IsString()
  pacienteId!: string;

  @IsOptional()
  @IsString()
  tratamientoId?: string;

  @IsOptional()
  @IsString()
  sedeId?: string;

  @IsOptional()
  @IsString()
  dentistaId?: string;

  @IsDateString()
  fecha!: string;

  @Matches(HORA, { message: 'horaInicio debe ser HH:MM' })
  horaInicio!: string;

  @Matches(HORA, { message: 'horaFin debe ser HH:MM' })
  horaFin!: string;

  @IsOptional()
  @IsString()
  observacion?: string;
}

export class UpdateCitaDto {
  @IsOptional()
  @IsDateString()
  fecha?: string;

  @IsOptional()
  @Matches(HORA, { message: 'horaInicio debe ser HH:MM' })
  horaInicio?: string;

  @IsOptional()
  @Matches(HORA, { message: 'horaFin debe ser HH:MM' })
  horaFin?: string;

  @IsOptional()
  @IsIn(['pendiente', 'confirmada', 'recordatorio_enviado', 'reprogramada', 'cancelada', 'realizada', 'no_asistio'])
  estado?: string;

  @IsOptional()
  @IsString()
  observacion?: string;

  @IsOptional()
  @IsString()
  tratamientoId?: string;
}
