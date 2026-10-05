import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@clinica.pe' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Clave-Segura-2026!' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
