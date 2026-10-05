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
  @IsString()
  descripcion!: string;

  @IsOptional()
  @IsString()
  tratamientoId?: string;

  @IsInt()
  @Min(1)
  cantidad!: number;

  @IsNumber()
  @Min(0)
  precioUnit!: number;
}

export class CreatePagoDto {
  @IsString()
  concepto!: string;

  @IsIn(['ingreso', 'egreso'])
  tipo!: string;

  @IsOptional()
  @IsString()
  pacienteId?: string;

  @IsOptional()
  @IsString()
  citaId?: string;

  @IsNumber()
  @Min(0.01)
  montoTotal!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  montoPagado?: number;

  @IsOptional()
  @IsString()
  metodoPago?: string;

  @IsOptional()
  @IsDateString()
  fecha?: string;

  @IsOptional()
  @IsString()
  observacion?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PagoDetalleDto)
  detalles?: PagoDetalleDto[];

  @IsOptional()
  cuotas?: Array<{ nroCuota: number; monto: number; fechaVencimiento: string }>;
}

export class AbonoDto {
  @IsNumber()
  @Min(0.01)
  monto!: number;

  @IsOptional()
  @IsString()
  metodoPago?: string;

  @IsOptional()
  @IsDateString()
  fecha?: string;
}
