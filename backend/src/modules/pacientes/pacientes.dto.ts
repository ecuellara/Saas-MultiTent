import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

/**
 * Carga del paciente completo según ADR-009 (conservar el modelo clínico):
 * identificación, datos de contacto, ubigeo, contacto de emergencia,
 * representante legal y antecedentes clínicos del `Paciente` de Prisma.
 */
export class CreatePacienteDto {
  @ApiPropertyOptional({ example: 'DNI' })
  @IsOptional()
  @IsString()
  tipoDoc?: string;

  @ApiPropertyOptional({ example: '74882211' })
  @IsOptional()
  @IsString()
  numDoc?: string;

  @ApiProperty({ example: 'Valeria' })
  @IsString()
  @IsNotEmpty()
  nombres!: string;

  @ApiProperty({ example: 'Quispe' })
  @IsString()
  @IsNotEmpty()
  apellidos!: string;

  @ApiPropertyOptional({ example: '1990-05-20' })
  @IsOptional()
  @IsDateString()
  fechaNac?: string;

  @ApiPropertyOptional({ example: 'F' })
  @IsOptional()
  @IsString()
  sexo?: string;

  @ApiPropertyOptional({ example: 'O+' })
  @IsOptional()
  @IsString()
  grupoSanguineo?: string;

  @ApiPropertyOptional({ example: '999000111' })
  @IsOptional()
  @IsString()
  telefono?: string;

  @ApiPropertyOptional({ example: 'paciente@correo.pe' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  direccion?: string;

  @ApiPropertyOptional({ example: '120101' })
  @IsOptional()
  @IsString()
  ubigeoCodigo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactoEmergenciaNombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactoEmergenciaTelefono?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  representanteNombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  representanteDni?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  representanteDomicilio?: string;

  @ApiPropertyOptional({ example: 'madre' })
  @IsOptional()
  @IsString()
  representanteParentesco?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  alergias?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  enfermedades?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  medicamentos?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  habitos?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  antecedentes?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class UpdatePacienteDto {
  @ApiPropertyOptional({ example: 'DNI' })
  @IsOptional()
  @IsString()
  tipoDoc?: string;

  @ApiPropertyOptional({ example: '74882211' })
  @IsOptional()
  @IsString()
  numDoc?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombres?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  apellidos?: string;

  @ApiPropertyOptional({ example: '1990-05-20' })
  @IsOptional()
  @IsDateString()
  fechaNac?: string;

  @ApiPropertyOptional({ example: 'F' })
  @IsOptional()
  @IsString()
  sexo?: string;

  @ApiPropertyOptional({ example: 'O+' })
  @IsOptional()
  @IsString()
  grupoSanguineo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  telefono?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  direccion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '120101' })
  @IsOptional()
  @IsString()
  ubigeoCodigo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactoEmergenciaNombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactoEmergenciaTelefono?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  representanteNombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  representanteDni?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  representanteDomicilio?: string;

  @ApiPropertyOptional({ example: 'madre' })
  @IsOptional()
  @IsString()
  representanteParentesco?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  alergias?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  enfermedades?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  medicamentos?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  habitos?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  antecedentes?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
