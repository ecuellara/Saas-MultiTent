import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BadRequestException, Injectable, Module, NotFoundException } from '@nestjs/common';
import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Response } from 'express';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';
import { StorageService } from '../../core/storage/storage.service.js';

/**
 * DTO del body de `PATCH /consentimientos/:id/estado` como CLASE normal, nunca
 * una intersección (`EstadoConsentimientoDto & { revocadoPor?: string }`).
 * Un tipo intersección hace que `emitDecoratorMetadata` emita `Object` como
 * metatipo y `ValidationPipe.toValidate()` devuelva false: se saltarían
 * `whitelist` y `forbidNonWhitelisted`, y el cliente podría inyectar
 * `revocadoPor` para atribuirse (o atribuir a otro) la revocación de un
 * consentimiento informado. La autoría sale SIEMPRE de `ctx.userId`.
 */
export class EstadoConsentimientoDto {
  @ApiProperty({ enum: ['borrador', 'firmado', 'revocado', 'anulado'] })
  @IsString()
  @IsIn(['borrador', 'firmado', 'revocado', 'anulado'])
  estado!: string;
}

export class CreatePlantillaDto {
  @ApiProperty({ example: 'endodoncia' })
  @IsString()
  clave!: string;

  @ApiProperty()
  @IsString()
  titulo!: string;

  @ApiProperty()
  @IsString()
  cuerpo!: string;
}

export class CreateConsentimientoDto {
  @ApiProperty()
  @IsString()
  pacienteId!: string;

  @ApiProperty()
  @IsString()
  plantillaId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  citaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tratamiento?: string;

  @ApiProperty()
  @IsObject()
  datosSnapshot!: Record<string, unknown>;
}

type FirmadoRow = Record<string, unknown> & {
  id: string;
  tenantId: string;
  estado: string;
};

type PacienteRow = {
  tenantId: string;
  fechaNac: Date | string | null;
  representanteNombre: string | null;
  representanteDni: string | null;
};

type Db = {
  consentimientoFirmado: {
    findUnique: (a: unknown) => Promise<FirmadoRow | null>;
    findMany: (a: unknown) => Promise<FirmadoRow[]>;
    create: (a: unknown) => Promise<FirmadoRow>;
    update: (a: unknown) => Promise<FirmadoRow>;
  };
  consentimientoPlantilla: {
    findMany: (a: unknown) => Promise<unknown>;
    findUnique: (a: unknown) => Promise<Record<string, unknown> | null>;
    create: (a: unknown) => Promise<unknown>;
  };
  paciente: { findUnique: (a: unknown) => Promise<PacienteRow | null> };
};

/**
 * Archivo recibido por multipart. Declarado aquí (no `Express.Multer.File`)
 * para no depender de `@types/multer`: igual que en `PacientesService`.
 */
export interface ArchivoSubido {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface FirmaDescarga {
  buffer: Buffer;
  nombreArchivo: string;
  mimeType: string;
}

/** Roles que firman un consentimiento (el autor sale del contexto, no del cuerpo). */
const ROLES_FIRMA = ['paciente', 'odontologo'] as const;

/** Mayoría de edad legal (Perú): 18 años cumplidos. */
const MAYORIA_DE_EDAD = 18;

/**
 * Edad en años cumplidos a la fecha de referencia. Se calcula con componentes
 * **UTC**: `fechaNac` es una columna `@db.Date` (medianoche UTC) y leerla con
 * getters locales desplaza el día en husos negativos (invariante 4).
 * Devuelve `null` si no hay fecha de nacimiento (dato desconocido).
 */
export function calcularEdad(
  fechaNac: Date | string | null | undefined,
  hoy = new Date(),
): number | null {
  if (!fechaNac) return null;
  const n = new Date(fechaNac);
  if (Number.isNaN(n.getTime())) return null;
  let edad = hoy.getUTCFullYear() - n.getUTCFullYear();
  const mes = hoy.getUTCMonth() - n.getUTCMonth();
  if (mes < 0 || (mes === 0 && hoy.getUTCDate() < n.getUTCDate())) edad -= 1;
  return edad;
}

/**
 * Consentimientos (doc §6): `cuerpoSnapshot` congela el texto al firmar;
 * revocación con trazabilidad (`revocadoEn/revocadoPor`).
 * Transiciones: borrador→firmado→revocado; anulado solo desde borrador.
 */
@Injectable()
export class ConsentimientosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}
  private get db(): Db {
    return this.prisma as unknown as Db;
  }

  /**
   * Lectura interna CON claves (para comprobar pertenencia y precondiciones).
   * Lo que sale por HTTP pasa por `obtener`, que las excluye.
   */
  private async leer(id: string): Promise<FirmadoRow> {
    const ctx = requireTenant();
    const c = await this.db.consentimientoFirmado.findUnique({ where: { id } });
    if (!c || c.tenantId !== ctx.tenantId) {
      throw new NotFoundException('Consentimiento no encontrado');
    }
    return c;
  }

  /**
   * Lectura pública: `select` explícito SIN claves de almacenamiento
   * (`firmaPacienteKey` / `firmaOdontologoKey` / `pdfKey` son rutas internas).
   * Incluye el título de la plantilla para la vista de impresión.
   */
  async obtener(id: string): Promise<Record<string, unknown>> {
    const ctx = requireTenant();
    const c = (await this.db.consentimientoFirmado.findUnique({
      where: { id },
      select: {
        id: true,
        tenantId: true,
        pacienteId: true,
        plantillaId: true,
        citaId: true,
        tratamiento: true,
        datosSnapshot: true,
        cuerpoSnapshot: true,
        estado: true,
        firmadoEn: true,
        revocadoEn: true,
        revocadoPor: true,
        createdAt: true,
        updatedAt: true,
        plantilla: { select: { id: true, titulo: true, clave: true } },
      },
    } as unknown as object)) as (Record<string, unknown> & { tenantId: string }) | null;
    if (!c || c.tenantId !== ctx.tenantId) {
      throw new NotFoundException('Consentimiento no encontrado');
    }
    return c;
  }

  /**
   * Listado por paciente (sin él la pantalla no puede mostrar nada). Verifica
   * primero que el paciente es del tenant (404 si no) y devuelve `select`
   * explícito SIN `cuerpoSnapshot` (largo) ni claves.
   */
  async listarPorPaciente(pacienteId: string): Promise<unknown[]> {
    const ctx = requireTenant();
    const p = await this.db.paciente.findUnique({ where: { id: pacienteId } });
    if (!p || p.tenantId !== ctx.tenantId) throw new NotFoundException('Paciente no encontrado');
    return this.db.consentimientoFirmado.findMany({
      where: { pacienteId, tenantId: ctx.tenantId },
      select: {
        id: true,
        tenantId: true,
        pacienteId: true,
        plantillaId: true,
        citaId: true,
        tratamiento: true,
        estado: true,
        firmadoEn: true,
        revocadoEn: true,
        createdAt: true,
        updatedAt: true,
        plantilla: { select: { id: true, titulo: true, clave: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async plantillas(): Promise<unknown> {
    requireTenant();
    return this.db.consentimientoPlantilla.findMany({ orderBy: { clave: 'asc' } });
  }

  async crearPlantilla(dto: CreatePlantillaDto): Promise<unknown> {
    const ctx = requireTenant();
    return this.db.consentimientoPlantilla.create({
      data: { ...dto, tenantId: ctx.tenantId },
    });
  }

  async crear(dto: CreateConsentimientoDto): Promise<FirmadoRow> {
    const ctx = requireTenant();
    const p = await this.db.paciente.findUnique({ where: { id: dto.pacienteId } });
    if (!p || p.tenantId !== ctx.tenantId) throw new NotFoundException('Paciente no encontrado');
    // Consentimiento informado de un MENOR: exige representante legal (doc §6).
    // Si no hay `fechaNac` la edad es desconocida y no se bloquea.
    const edad = calcularEdad(p.fechaNac);
    if (edad !== null && edad < MAYORIA_DE_EDAD) {
      const nombre = (p.representanteNombre ?? '').trim();
      const dni = (p.representanteDni ?? '').trim();
      if (!nombre || !dni) {
        throw new BadRequestException(
          'El paciente es menor de edad: se requiere representanteNombre y representanteDni',
        );
      }
    }
    const plantilla = await this.db.consentimientoPlantilla.findUnique({
      where: { id: dto.plantillaId },
    });
    if (!plantilla || (plantilla.tenantId as string) !== ctx.tenantId) {
      throw new NotFoundException('Plantilla no encontrada');
    }
    return (await this.db.consentimientoFirmado.create({
      data: {
        tenantId: ctx.tenantId,
        pacienteId: dto.pacienteId,
        plantillaId: dto.plantillaId,
        citaId: dto.citaId ?? null,
        tratamiento: dto.tratamiento ?? null,
        datosSnapshot: dto.datosSnapshot,
        // Congela el texto vigente al momento de crear/firmar.
        cuerpoSnapshot: plantilla.cuerpo as string,
        estado: 'borrador',
      },
      // Sin claves de almacenamiento en la respuesta (aún son null, pero la
      // forma explícita impide que una futura columna se cuele sola).
      select: {
        id: true,
        tenantId: true,
        pacienteId: true,
        plantillaId: true,
        citaId: true,
        tratamiento: true,
        datosSnapshot: true,
        cuerpoSnapshot: true,
        estado: true,
        firmadoEn: true,
        revocadoEn: true,
        revocadoPor: true,
        createdAt: true,
        updatedAt: true,
      },
    } as unknown as object)) as unknown as FirmadoRow;
  }

  /**
   * Transición de estado. La autoría de la revocación sale SIEMPRE de
   * `ctx.userId` (nunca del body) y la fecha del reloj del servidor.
   *
   * DECISIÓN (documentada a pedido): pasar a `firmado` EXIGE la firma del
   * paciente ya adjunta (400 si falta). Un «firmado» sin firma del paciente
   * no vale nada como documento legal y contradice la vista de impresión;
   * la del odontólogo sigue siendo opcional para no bloquear flujos de una
   * sola firma. No cambia estados ni transiciones, solo añade la precondición.
   */
  async cambiarEstado(id: string, estado: string): Promise<FirmadoRow> {
    const actual = await this.leer(id);
    const desde = actual.estado;
    const permitidas: Record<string, string[]> = {
      borrador: ['firmado', 'anulado'],
      firmado: ['revocado'],
      revocado: [],
      anulado: [],
    };
    if (!permitidas[desde]?.includes(estado)) {
      throw new BadRequestException(`Transición ${desde}→${estado} no permitida`);
    }
    if (estado === 'firmado' && !(actual.firmaPacienteKey as string | null)) {
      throw new BadRequestException(
        'Falta la firma del paciente: adjúntala antes de marcar como firmado',
      );
    }
    const ctx = requireTenant();
    // `select` explícito: la respuesta nunca lleva claves de almacenamiento.
    return (await this.db.consentimientoFirmado.update({
      where: { id },
      data: {
        estado,
        ...(estado === 'firmado' ? { firmadoEn: new Date() } : {}),
        ...(estado === 'revocado' ? { revocadoEn: new Date(), revocadoPor: ctx.userId } : {}),
      },
      select: {
        id: true,
        tenantId: true,
        pacienteId: true,
        plantillaId: true,
        citaId: true,
        tratamiento: true,
        datosSnapshot: true,
        cuerpoSnapshot: true,
        estado: true,
        firmadoEn: true,
        revocadoEn: true,
        revocadoPor: true,
        createdAt: true,
        updatedAt: true,
      },
    } as unknown as object)) as unknown as FirmadoRow;
  }

  /**
   * Adjunta la firma manuscrita (PNG/JPEG por CONTENIDO, no por extensión).
   * Solo en `borrador`: un consentimiento firmado es inmutable, igual que el
   * odontograma firmado. Copia el patrón de `subirDocumento`, incluida la
   * compensación si la base falla tras guardar el archivo.
   */
  async adjuntarFirma(
    id: string,
    rol: string,
    archivo: ArchivoSubido | undefined,
  ): Promise<Record<string, unknown>> {
    const ctx = requireTenant();
    const c = await this.leer(id);
    if (c.estado !== 'borrador') {
      throw new BadRequestException(
        'Solo se adjunta firma en borrador: un consentimiento firmado es inmutable',
      );
    }
    if (rol !== 'paciente' && rol !== 'odontologo') {
      throw new BadRequestException("rol debe ser 'paciente' u 'odontologo'");
    }
    if (!archivo || !Buffer.isBuffer(archivo.buffer)) {
      throw new BadRequestException('Falta el archivo');
    }
    if (archivo.size <= 0) {
      throw new BadRequestException('El archivo está vacío');
    }
    if (archivo.size > StorageService.MAX_KB * 1024) {
      throw new BadRequestException('Archivo demasiado grande');
    }
    // Solo imágenes: una firma manuscrita no es un PDF. Se decide por firma
    // real (magic bytes); un HTML renombrado a .png se rechaza aquí.
    const detectado = this.storage.firmarMime(archivo.buffer);
    if (detectado !== 'image/png' && detectado !== 'image/jpeg') {
      throw new BadRequestException('La firma debe ser una imagen PNG o JPEG');
    }
    const campo = rol === 'paciente' ? 'firmaPacienteKey' : 'firmaOdontologoKey';
    const storageKey = this.storage.construirClave(
      ctx.tenantId,
      'consents',
      id,
      rol,
      `${randomUUID()}.${detectado === 'image/png' ? 'png' : 'jpg'}`,
    );
    await this.storage.escribirLocal(ctx.tenantId, storageKey, archivo.buffer);
    try {
      return (await this.db.consentimientoFirmado.update({
        where: { id },
        data: { [campo]: storageKey },
        select: {
          id: true,
          tenantId: true,
          pacienteId: true,
          estado: true,
          firmadoEn: true,
          updatedAt: true,
        },
      } as unknown as object)) as unknown as Record<string, unknown>;
    } catch (e) {
      // Compensación: sin fila, el archivo quedaría huérfano.
      await this.storage.eliminarLocal(storageKey).catch(() => undefined);
      throw e;
    }
  }

  /**
   * Entrega la imagen de la firma (bytes con MIME verificado), nunca la clave.
   * No hay columna con el MIME: se detecta del contenido y solo se sirve si es
   * imagen (misma garantía que la descarga de documentos, sin duplicar su
   * forma porque aquí no hay MIME declarado contra el que comparar).
   */
  async descargarFirma(id: string, rol: string): Promise<FirmaDescarga> {
    const ctx = requireTenant();
    const c = await this.leer(id);
    if (rol !== 'paciente' && rol !== 'odontologo') {
      throw new NotFoundException('Firma no encontrada');
    }
    const key = (
      rol === 'paciente' ? c.firmaPacienteKey : c.firmaOdontologoKey
    ) as string | null;
    if (!key) throw new NotFoundException('Firma no encontrada');
    this.storage.assertClaveTenant(ctx.tenantId, key);
    let ruta: string;
    try {
      ruta = this.storage.rutaLocal(key);
    } catch {
      throw new NotFoundException('Firma no encontrada');
    }
    let contenido: Buffer;
    try {
      contenido = await readFile(ruta);
    } catch {
      throw new NotFoundException('Firma no encontrada');
    }
    const detectado = this.storage.firmarMime(contenido);
    if (detectado !== 'image/png' && detectado !== 'image/jpeg') {
      // eslint-disable-next-line no-console
      console.warn(`[storage] firma con contenido inesperado (tenant=${ctx.tenantId})`);
      throw new NotFoundException('Firma no encontrada');
    }
    return {
      buffer: contenido,
      nombreArchivo: `firma-${rol}.${detectado === 'image/png' ? 'png' : 'jpg'}`,
      mimeType: detectado,
    };
  }
}

@ApiTags('consentimientos')
@Controller('consentimientos')
export class ConsentimientosController {
  constructor(private readonly service: ConsentimientosService) {}

  @Get('plantillas')
  @RequirePermission('consents.read')
  plantillas(): Promise<unknown> {
    return this.service.plantillas();
  }

  @Post('plantillas')
  @RequirePermission('consents.write')
  crearPlantilla(@Body() dto: CreatePlantillaDto): Promise<unknown> {
    return this.service.crearPlantilla(dto);
  }

  @Post()
  @RequirePermission('consents.write')
  crear(@Body() dto: CreateConsentimientoDto): Promise<unknown> {
    return this.service.crear(dto);
  }

  @Get(':id')
  @RequirePermission('consents.read')
  obtener(@Param('id') id: string): Promise<unknown> {
    return this.service.obtener(id);
  }

  @Get()
  @RequirePermission('consents.read')
  listar(@Query('pacienteId') pacienteId: string): Promise<unknown> {
    if (typeof pacienteId !== 'string' || pacienteId.trim() === '') {
      throw new BadRequestException('pacienteId es obligatorio');
    }
    return this.service.listarPorPaciente(pacienteId);
  }

  /**
   * Subida REAL de la firma manuscrita (multipart, campo `archivo` + campo
   * `rol`). Igual que en pacientes: `memoryStorage` por defecto (sin
   * `@types/multer`) y el límite lo aplica multer antes del manejador.
   */
  @Post(':id/firmas')
  @RequirePermission('consents.write')
  @UseInterceptors(
    FileInterceptor('archivo', {
      limits: { fileSize: StorageService.MAX_KB * 1024, files: 1 },
    }),
  )
  @HttpCode(201)
  adjuntarFirma(
    @Param('id') id: string,
    @UploadedFile() archivo: ArchivoSubido | undefined,
    @Body('rol') rol: string,
  ): Promise<unknown> {
    return this.service.adjuntarFirma(id, rol, archivo);
  }

  @Get(':id/firmas/:rol')
  @RequirePermission('consents.read')
  async descargarFirma(
    @Param('id') id: string,
    @Param('rol') rol: string,
    @Res() res: Response,
  ): Promise<void> {
    const f = await this.service.descargarFirma(id, rol);
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('Content-Length', String(f.buffer.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', ConsentimientosController.contentDisposition(f.nombreArchivo));
    res.end(f.buffer);
  }

  @Patch(':id/estado')
  @RequirePermission('consents.write')
  cambiarEstado(
    @Param('id') id: string,
    @Body() dto: EstadoConsentimientoDto,
  ): Promise<unknown> {
    return this.service.cambiarEstado(id, dto.estado);
  }

  /**
   * `Content-Disposition: attachment` seguro (misma regla que en pacientes:
   * `filename` ASCII sin comillas/barras/CR-LF + `filename*` RFC 5987).
   */
  private static contentDisposition(nombreArchivo: string): string {
    const ascii = nombreArchivo
      .replace(/[\\"\r\n\u0000-\u001f\u007f]/g, '')
      .replace(/[^\u0020-\u007e]/g, '_')
      .trim();
    const respaldo = ascii.length > 0 ? ascii : 'firma';
    const extendido = encodeURIComponent(nombreArchivo.replace(/[\r\n\u0000-\u001f\u007f]/g, ''));
    return `attachment; filename="${respaldo}"; filename*=UTF-8''${extendido}`;
  }
}

@Module({
  controllers: [ConsentimientosController],
  providers: [ConsentimientosService, StorageService],
})
export class ConsentimientosModule {}
