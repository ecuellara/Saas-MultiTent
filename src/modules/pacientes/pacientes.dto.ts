import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreatePacienteDto {
  @IsOptional()
  @IsString()
  tipoDoc?: string;

  @IsOptional()
  @IsString()
  numDoc?: string;

  @IsString()
  @IsNotEmpty()
  nombres!: string;

  @IsString()
  @IsNotEmpty()
  apellidos!: string;

  @IsOptional()
  @IsString()
  telefono?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  direccion?: string;
}

export class UpdatePacienteDto {
  @IsOptional()
  @IsString()
  nombres?: string;

  @IsOptional()
  @IsString()
  apellidos?: string;

  @IsOptional()
  @IsString()
  telefono?: string;

  @IsOptional()
  @IsString()
  direccion?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
