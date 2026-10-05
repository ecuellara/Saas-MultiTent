import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BadRequestException, Injectable, Module, NotFoundException } from '@nestjs/common';
import { IsArray, IsDateString, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { aCentimos, desdeCentimos } from '../../core/money/money.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { SecuenciasService } from '../../core/secuencias/secuencias.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';

export class CompraDetalleDto {
  @ApiProperty()
  @IsString()
  insumoId!: string;

  @ApiProperty({ example: 10 })
  @IsInt()
  @Min(1)
  cantidad!: number;

  @ApiProperty({ example: 25 })
  @IsNumber()
  @Min(0)
  precioUnit!: number;
}

export class CreateCompraDto {
  @ApiProperty()
  @IsString()
  proveedorId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiProperty()
  @IsDateString()
  fecha!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observacion?: string;

  @ApiProperty({ type: [CompraDetalleDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompraDetalleDto)
  detalles!: CompraDetalleDto[];
}

type CompraRow = Record<string, unknown> & { id: string; tenantId: string };

@Injectable()
export class ComprasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secuencias: SecuenciasService,
  ) {}

  async listar(): Promise<unknown> {
    requireTenant();
    const db = this.prisma as unknown as { compra: { findMany: (a: unknown) => Promise<CompraRow[]> } };
    return db.compra.findMany({ orderBy: { fecha: 'desc' } });
  }

  async obtener(id: string): Promise<CompraRow> {
    const ctx = requireTenant();
    const db = this.prisma as unknown as {
      compra: { findUnique: (a: unknown) => Promise<CompraRow | null> };
    };
    const c = await db.compra.findUnique({ where: { id }, include: { detalles: true } } as unknown as object);
    if (!c || c.tenantId !== ctx.tenantId) throw new NotFoundException('Compra no encontrada');
    return c;
  }

  /**
   * Compra atómica: crea compra + detalles, incrementa stock y registra
   * el movimiento de entrada. Transacción Serializable: ante P2034 el
   * llamador puede reintentar (el filtro global la traduce a 409).
   */
  async crear(dto: CreateCompraDto): Promise<CompraRow> {
    const ctx = requireTenant();
    if (!dto.detalles?.length) throw new BadRequestException('La compra requiere detalles');
    const db = this.prisma as unknown as {
      proveedor: { findUnique: (a: unknown) => Promise<{ tenantId: string } | null> };
      insumo: { findUnique: (a: unknown) => Promise<{ tenantId: string } | null> };
    };
    const prov = await db.proveedor.findUnique({ where: { id: dto.proveedorId } });
    if (!prov || prov.tenantId !== ctx.tenantId) throw new NotFoundException('Proveedor no encontrado');
    for (const d of dto.detalles) {
      const ins = await db.insumo.findUnique({ where: { id: d.insumoId } });
      if (!ins || ins.tenantId !== ctx.tenantId) {
        throw new NotFoundException(`Insumo no encontrado: ${d.insumoId}`);
      }
    }
    const fecha = new Date(dto.fecha);
    // Total = suma de subtotales, calculado en céntimos enteros (política única).
    const subtotalesCent = dto.detalles.map((d) => aCentimos(d.cantidad * d.precioUnit));
    const montoTotal = desdeCentimos(subtotalesCent.reduce((s, v) => s + v, 0));
    const codigo = await this.secuencias.siguienteCodigoCompra(fecha);
    // El egreso usa el mismo correlativo REC-<año> de los ingresos. Se calcula
    // FUERA de la transacción: contar dentro de ella consumiría otra conexión
    // con la transacción abierta.
    const reciboEgreso = await this.secuencias.siguienteCodigoRecibo(fecha);

    return this.prisma.$transaction(
      async (tx) => {
        const t = tx as unknown as {
          compra: { create: (a: unknown) => Promise<CompraRow> };
          insumo: {
            findFirstOrThrow: (a: unknown) => Promise<{ stockActual: number }>;
            update: (a: unknown) => Promise<unknown>;
          };
          movimientoInventario: { create: (a: unknown) => Promise<unknown> };
          pago: { create: (a: unknown) => Promise<unknown> };
        };
        const compra = await t.compra.create({
          data: {
            tenantId: ctx.tenantId,
            proveedorId: dto.proveedorId,
            sedeId: dto.sedeId ?? ctx.sedeId ?? null,
            codigo,
            fecha,
            montoTotal,
            observacion: dto.observacion ?? null,
            usuarioId: ctx.userId,
            detalles: {
              create: dto.detalles.map((d, i) => ({
                tenantId: ctx.tenantId,
                insumoId: d.insumoId,
                cantidad: d.cantidad,
                precioUnit: d.precioUnit,
                subtotal: desdeCentimos(subtotalesCent[i] ?? 0),
              })),
            },
          },
        });
        for (const d of dto.detalles) {
          // Lectura acotada al tenant + incremento ATÓMICO del stock: no se
          // pierde una entrada cuando hay compras concurrentes del mismo insumo.
          const ins = await t.insumo.findFirstOrThrow({
            where: { id: d.insumoId, tenantId: ctx.tenantId },
          });
          const anterior = ins.stockActual;
          await t.insumo.update({
            where: { id: d.insumoId },
            data: { stockActual: { increment: d.cantidad } },
          });
          await t.movimientoInventario.create({
            data: {
              tenantId: ctx.tenantId,
              insumoId: d.insumoId,
              tipo: 'entrada',
              cantidad: d.cantidad,
              stockAnterior: anterior,
              stockNuevo: anterior + d.cantidad,
              motivo: `compra ${codigo}`,
              referenciaTipo: 'compra',
              referenciaId: compra.id,
              usuarioId: ctx.userId,
            },
          });
        }
        // El egreso en caja va en la MISMA transacción (doc §2: no perder
        // "compra atómica que actualiza stock y genera el egreso"). Si falla,
        // no queda stock incrementado sin gasto registrado.
        await t.pago.create({
          data: {
            tenantId: ctx.tenantId,
            codigoRecibo: reciboEgreso,
            tipo: 'egreso',
            concepto: `Compra ${codigo}`,
            montoTotal,
            montoPagado: montoTotal,
            saldo: 0,
            estado: 'pagado',
            referenciaTipo: 'compra',
            referenciaId: compra.id,
            fecha,
            usuarioId: ctx.userId,
          },
        });
        return compra;
      },
      { isolationLevel: 'Serializable' },
    );
  }
}

@ApiTags('compras')
@Controller('compras')
export class ComprasController {
  constructor(private readonly service: ComprasService) {}

  @Get()
  listar(): Promise<unknown> {
    return this.service.listar();
  }

  @Post()
  @RequirePermission('inventory.write')
  crear(@Body() dto: CreateCompraDto): Promise<unknown> {
    return this.service.crear(dto);
  }

  @Get(':id')
  obtener(@Param('id') id: string): Promise<unknown> {
    return this.service.obtener(id);
  }
}

@Module({ controllers: [ComprasController], providers: [ComprasService] })
export class ComprasModule {}
