import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StorageService } from '../../core/storage/storage.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';

type Db = {
  paciente: {
    findMany: (a: unknown) => Promise<Array<{ id: string; tenantId: string }>>;
    findUnique: (a: unknown) => Promise<Record<string, unknown> | null>;
    create: (a: unknown) => Promise<Record<string, unknown>>;
    update: (a: unknown) => Promise<Record<string, unknown>>;
  };
  historialClinico: { findMany: (a: unknown) => Promise<unknown> };
  documentoPaciente: {
    findMany: (a: unknown) => Promise<unknown>;
    findUnique: (a: unknown) => Promise<Record<string, unknown> | null>;
    create: (a: unknown) => Promise<Record<string, unknown>>;
  };
  odontograma: { findMany: (a: unknown) => Promise<unknown> };
};

export interface CreateDocumentoDto {
  nombreArchivo: string;
  tipo: string;
  mimeType: string;
  tamanioKb?: number;
}

/** Documento listo para entregarse como archivo (no como metadatos JSON). */
export interface DocumentoDescarga {
  buffer: Buffer;
  /** Nombre saneado que viaja en el `Content-Disposition`. */
  nombreArchivo: string;
  /** MIME verificado contra la firma real del contenido en disco. */
  mimeType: string;
}

/**
 * Archivo recibido por multipart.
 *
 * Se declara aquí en lugar de usar `Express.Multer.File` para no depender de
 * `@types/multer`, que no está instalado en el proyecto: `FileInterceptor` usa
 * `memoryStorage` **por defecto**, de modo que lo único que necesitamos es el
 * `buffer`, el `size` real y el nombre original.
 */
export interface ArchivoSubido {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Tipos de documento admitidos al SUBIR bytes (los documentados en el esquema). */
const TIPOS_DOCUMENTO = new Set([
  'RX_PANORAMICA',
  'RX_PERIAPICAL',
  'FOTO',
  'CONSENTIMIENTO',
  'RECETA',
  'INFORME',
  'OTRO',
]);

@Injectable()
export class PacientesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}
  private get db(): Db {
    return this.prisma as unknown as Db;
  }

  async listar(limit = 100): Promise<unknown> {
    requireTenant();
    return this.db.paciente.findMany({
      where: { deletedAt: null },
      take: Math.min(Math.max(limit || 100, 1), 200),
      orderBy: { createdAt: 'desc' },
    });
  }

  async obtener(id: string): Promise<Record<string, unknown>> {
    const ctx = requireTenant();
    const p = await this.db.paciente.findUnique({ where: { id } });
    if (!p || p.tenantId !== ctx.tenantId || (p as { deletedAt?: Date | null }).deletedAt) {
      throw new NotFoundException('Paciente no encontrado');
    }
    return p;
  }

  async crear(dto: Record<string, unknown>): Promise<Record<string, unknown>> {
    const ctx = requireTenant();
    const { tenantId: _ignored, ...resto } = dto;
    return this.db.paciente.create({
      data: { ...resto, tenantId: ctx.tenantId },
    });
  }

  async actualizar(id: string, dto: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.obtener(id);
    const { tenantId: _ignored, ...resto } = dto;
    return this.db.paciente.update({ where: { id }, data: resto });
  }

  async eliminar(id: string): Promise<{ id: string }> {
    await this.obtener(id);
    await this.db.paciente.update({ where: { id }, data: { deletedAt: new Date() } });
    return { id };
  }

  async historiales(id: string): Promise<unknown> {
    await this.obtener(id);
    return this.db.historialClinico.findMany({ where: { pacienteId: id } });
  }

  async documentos(id: string): Promise<unknown> {
    await this.obtener(id);
    // `storageKey` NO se expone: es una ruta interna del almacenamiento, no le
    // sirve al cliente (la descarga tiene su propio endpoint) y publicarla
    // facilita mapear la estructura del bucket.
    return this.db.documentoPaciente.findMany({
      where: { pacienteId: id, deletedAt: null },
      select: {
        id: true,
        pacienteId: true,
        nombreArchivo: true,
        tipo: true,
        mimeType: true,
        tamanioKb: true,
        url: true,
        createdAt: true,
      },
    });
  }

  async registrarDocumento(id: string, dto: CreateDocumentoDto): Promise<Record<string, unknown>> {
    const ctx = requireTenant();
    const paciente = await this.obtener(id);
    try {
      this.storage.validarSubida(dto.mimeType, dto.tamanioKb);
    } catch {
      throw new BadRequestException('Archivo no permitido');
    }
    // La clave se construye SIEMPRE en el servidor (doc §9). Aceptarla del
    // cliente permitía registrar el documento del paciente X apuntando al
    // archivo del paciente Y dentro del mismo tenant, y descargarlo después.
    const storageKey = this.storage.construirClave(
      ctx.tenantId,
      'patients',
      paciente.id as string,
      'documents',
      dto.nombreArchivo,
    );
    return this.db.documentoPaciente.create({
      data: {
        tenantId: ctx.tenantId,
        pacienteId: id,
        nombreArchivo: dto.nombreArchivo,
        tipo: dto.tipo,
        mimeType: dto.mimeType,
        tamanioKb: dto.tamanioKb ?? null,
        storageKey,
      },
    });
  }

  /**
   * Sube el ARCHIVO de un documento (a diferencia de `registrarDocumento`, que
   * sólo guarda metadatos y dejaba el flujo clínico a medias: se podía registrar
   * una radiografía, pero no adjuntarla nunca).
   *
   * Todo lo que decide el cliente se desconfía:
   * - el **tipo** se determina por el CONTENIDO (magic bytes), no por el
   *   `mimetype` declarado en el multipart;
   * - el **tamaño** sale de `file.size` (real), no de un campo del formulario;
   * - la **clave** la construye el servidor con el `tenantId` del contexto.
   */
  async subirDocumento(
    id: string,
    archivo: ArchivoSubido | undefined,
    tipo: string,
  ): Promise<Record<string, unknown>> {
    const ctx = requireTenant();
    const paciente = await this.obtener(id);

    if (!archivo || !Buffer.isBuffer(archivo.buffer)) {
      throw new BadRequestException('Falta el archivo');
    }
    if (!TIPOS_DOCUMENTO.has(tipo)) {
      throw new BadRequestException('Tipo de documento no permitido');
    }
    if (archivo.size <= 0) {
      throw new BadRequestException('El archivo está vacío');
    }
    if (archivo.size > StorageService.MAX_KB * 1024) {
      throw new BadRequestException('Archivo demasiado grande');
    }

    // El tipo lo decide el contenido, no lo que declare el cliente: un HTML
    // renombrado a .png se rechaza aquí y no llega nunca al disco.
    const detectado = this.storage.firmarMime(archivo.buffer);
    if (!detectado) {
      throw new BadRequestException('El contenido no es un tipo de archivo permitido');
    }

    // Nombre saneado: sin separadores (evita anidar rutas) ni `..`, y acotado.
    const nombreSeguro = (archivo.originalname || 'archivo')
      .replace(/[\\/]/g, '_')
      .replace(/\.\./g, '')
      .slice(0, 120);
    const storageKey = this.storage.construirClave(
      ctx.tenantId,
      'patients',
      paciente.id as string,
      'documents',
      `${randomUUID()}-${nombreSeguro}`,
    );

    await this.storage.escribirLocal(ctx.tenantId, storageKey, archivo.buffer);

    try {
      return await this.db.documentoPaciente.create({
        data: {
          tenantId: ctx.tenantId,
          pacienteId: id,
          nombreArchivo: archivo.originalname || 'archivo',
          tipo,
          // Se persiste el MIME DETECTADO, no el declarado: lo que se sirva
          // después debe coincidir con lo que la fila afirma.
          mimeType: detectado,
          tamanioKb: Math.max(1, Math.ceil(archivo.size / 1024)),
          storageKey,
        },
        // La `storageKey` no se expone (es una ruta interna del almacenamiento).
        select: {
          id: true,
          pacienteId: true,
          nombreArchivo: true,
          tipo: true,
          mimeType: true,
          tamanioKb: true,
          createdAt: true,
        },
      });
    } catch (e) {
      // Compensación: el archivo ya está en disco, así que si la fila no se crea
      // quedaría huérfano (defecto que ya se detectó en la auditoría inicial del
      // proyecto). Se borra y se propaga el error original.
      await this.storage.eliminarLocal(storageKey).catch(() => undefined);
      throw e;
    }
  }

  /**
   * Entrega el ARCHIVO del documento (proveedor local), no sus metadatos.
   *
   * Antes devolvía la fila `DocumentoPaciente` —incluida la `storageKey` en
   * claro— y el controlador la serializaba como JSON: el usuario pedía una
   * descarga y recibía un JSON con la ruta interna del archivo.
   */
  async descarga(id: string, docId: string): Promise<DocumentoDescarga> {
    const ctx = requireTenant();
    const paciente = await this.obtener(id);
    const doc = await this.db.documentoPaciente.findUnique({ where: { id: docId } });
    if (
      !doc ||
      doc.tenantId !== ctx.tenantId ||
      (doc.pacienteId as string) !== (paciente.id as string) ||
      ((doc as { deletedAt?: Date | null }).deletedAt ?? null) !== null
    ) {
      throw new NotFoundException('Documento no encontrado');
    }
    // Defensa en profundidad: revalida la clave almacenada (prefijo del tenant
    // y sin traversal) y valida la firma real del contenido contra el mimeType
    // declarado antes de entregar un solo byte.
    const buffer = await this.storage.leerDocumentoValidado(
      ctx.tenantId,
      doc.storageKey as string,
      doc.mimeType as string,
    );
    return {
      buffer,
      nombreArchivo: doc.nombreArchivo as string,
      mimeType: doc.mimeType as string,
    };
  }

  async odontogramas(id: string): Promise<unknown> {
    await this.obtener(id);
    return this.db.odontograma.findMany({ where: { pacienteId: id } });
  }
}
