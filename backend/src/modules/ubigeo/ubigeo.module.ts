import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../core/prisma/prisma.service.js';

/**
 * Catálogo global de ubigeos del Perú (departamento/provincia/distrito).
 *
 * El catálogo está VACÍO en producción (tarea de DATOS pendiente: cargarlo es
 * aparte y no se inventan códigos). Este endpoint solo dice si hay datos para
 * que el formulario de paciente no ofrezca un campo libre que el guardado
 * rechazaría: con catálogo vacío el campo se deshabilita con el motivo.
 */
@Injectable()
export class UbigeoService {
  constructor(private readonly prisma: PrismaService) {}

  async estado(): Promise<{ total: number }> {
    const db = this.prisma as unknown as {
      ubigeo: { count: (a: unknown) => Promise<number> };
    };
    return { total: await db.ubigeo.count({}) };
  }
}

@ApiTags('ubigeos')
@Controller('ubigeos')
export class UbigeoController {
  constructor(private readonly service: UbigeoService) {}

  /** Sin permiso específico: dato de referencia global, como el listado de sedes. */
  @Get('estado')
  estado(): Promise<{ total: number }> {
    return this.service.estado();
  }
}

@Module({ controllers: [UbigeoController], providers: [UbigeoService] })
export class UbigeoModule {}
