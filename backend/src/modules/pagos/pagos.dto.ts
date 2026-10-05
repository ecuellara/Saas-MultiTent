import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PagoDetalleDto {
  @ApiProperty({ example: 'Limpieza dental' })
  @IsString()
  descripcion!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tratamientoId?: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  cantidad!: number;

  @ApiProperty({ example: 120 })
  @IsNumber()
  @Min(0)
  precioUnit!: number;
}

export class CreatePagoDto {
  @ApiProperty({ example: 'Limpieza dental' })
  @IsString()
  concepto!: string;

  @ApiProperty({ enum: ['ingreso', 'egreso'] })
  @IsIn(['ingreso', 'egreso'])
  tipo!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pacienteId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  citaId?: string;

  @ApiProperty({ example: 120 })
  @IsNumber()
  @Min(0.01)
  montoTotal!: number;

  @ApiPropertyOptional({ example: 60 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  montoPagado?: number;

  @ApiPropertyOptional({ example: 'efectivo' })
  @IsOptional()
  @IsString()
  metodoPago?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fecha?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observacion?: string;

  @ApiPropertyOptional({ type: [PagoDetalleDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PagoDetalleDto)
  detalles?: PagoDetalleDto[];

  @ApiPropertyOptional()
  @IsOptional()
  cuotas?: Array<{ nroCuota: number; monto: number; fechaVencimiento: string }>;
}

export class AbonoDto {
  @ApiProperty({ example: 40 })
  @IsNumber()
  @Min(0.01)
  monto!: number;

  @ApiPropertyOptional({ example: 'yape' })
  @IsOptional()
  @IsString()
  metodoPago?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fecha?: string;
}
