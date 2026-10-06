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

/**
 * Cuota del plan de pagos.
 *
 * Antes `cuotas` se declaraba como `Array<{...}>` sin validadores: el
 * `@IsOptional()` mantenía la propiedad en el whitelist pero **no comprobaba
 * nada de su contenido**, así que un cliente podía enviar `monto: 'mucho'` o
 * `fechaVencimiento: false` y el servicio los pasaba a Prisma tal cual. Con
 * `ValidateNested` cada cuota se valida de verdad.
 */
export class CuotaDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  nroCuota!: number;

  @ApiProperty({ example: 60 })
  @IsNumber()
  @Min(0.01)
  monto!: number;

  @ApiProperty({ example: '2026-04-10' })
  @IsDateString()
  fechaVencimiento!: string;
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

  @ApiPropertyOptional({ type: [CuotaDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CuotaDto)
  cuotas?: CuotaDto[];
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
