import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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

  @ApiPropertyOptional({ example: '999000111' })
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
  direccion?: string;
}

export class UpdatePacienteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombres?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  apellidos?: string;

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
}
