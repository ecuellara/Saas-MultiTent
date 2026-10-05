import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, Matches } from 'class-validator';

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

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
