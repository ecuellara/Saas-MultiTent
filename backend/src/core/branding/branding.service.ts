import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

/**
 * Marca guardada en `TenantConfig.logoUrl` cuando el logo vive en el storage
 * del tenant. No se guarda la clave: es determinista (`branding/logo.<ext>`) y
 * así el bucket puede seguir siendo privado.
 */
export const LOGO_MARCA_STORAGE = '__storage__';

/** Tope propio del logo (2 MB), independiente del tope de documentos (20 MB). */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** Extensiones posibles del logo, en el orden en que se sirve. */
export const LOGO_EXTENSIONES = ['png', 'jpg'] as const;

/** Archivo recibido por multipart (memoryStorage; sin depender de @types/multer). */
export interface ArchivoSubido {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

type DbBranding = {
  tenant: {
    findUnique: (a: unknown) => Promise<{ id: string; slug?: string } | null>;
  };
  tenantConfig: {
    findUnique: (a: unknown) => Promise<{ logoUrl: string | null } | null>;
    upsert: (a: unknown) => Promise<unknown>;
  };
};

/**
 * Personalización de marca por clínica: logo privado en Storage y colores.
 *
 * El logo se guarda SIEMPRE con una clave construida por el servidor bajo el
 * prefijo del tenant. La ruta pública lo sirve leyendo del backend, nunca con
 * una URL pública del bucket.
 */
@Injectable()
export class BrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private get db(): DbBranding {
    return this.prisma as unknown as DbBranding;
  }

  private claveLogo(tenantId: string, extension: (typeof LOGO_EXTENSIONES)[number]): string {
    return this.storage.construirClave(tenantId, 'branding', `logo.${extension}`);
  }

  private async exigirTenant(tenantId: string): Promise<void> {
    const tenant = await this.db.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');
  }

  /**
   * Reemplaza el logo del tenant. Valida la firma REAL del contenido (un HTML
   * renombrado a .png se rechaza) y borra la extensión anterior tras guardar.
   */
  async subirLogo(tenantId: string, archivo: ArchivoSubido | undefined): Promise<void> {
    await this.exigirTenant(tenantId);
    if (!archivo) throw new BadRequestException('Falta el archivo del logo');
    if (archivo.size <= 0 || archivo.buffer.length === 0) {
      throw new BadRequestException('El archivo está vacío');
    }
    if (archivo.size > LOGO_MAX_BYTES) {
      throw new BadRequestException('El logo no puede superar 2 MB');
    }

    const detectado = this.storage.firmarMime(archivo.buffer);
    if (detectado !== 'image/png' && detectado !== 'image/jpeg') {
      throw new BadRequestException('El logo debe ser una imagen PNG o JPEG');
    }
    const extension = detectado === 'image/png' ? 'png' : 'jpg';
    const clave = this.claveLogo(tenantId, extension);
    const extensionAnterior = extension === 'png' ? 'jpg' : 'png';
    const claveAnterior = this.claveLogo(tenantId, extensionAnterior);

    // Si el tenant ya tenía un logo en la MISMA extensión, se conserva en
    // memoria para restaurarlo si la actualización de la base falla.
    let contenidoAnterior: Buffer | null = null;
    try {
      contenidoAnterior = await this.storage.leer(tenantId, clave);
    } catch {
      contenidoAnterior = null;
    }

    await this.storage.guardar(tenantId, clave, archivo.buffer);
    try {
      await this.db.tenantConfig.upsert({
        where: { tenantId },
        update: { logoUrl: LOGO_MARCA_STORAGE },
        create: { tenantId, logoUrl: LOGO_MARCA_STORAGE },
      });
    } catch (e) {
      if (contenidoAnterior) {
        await this.storage.guardar(tenantId, clave, contenidoAnterior).catch(() => undefined);
      } else {
        await this.storage.eliminar(clave).catch(() => undefined);
      }
      throw e;
    }

    // La clave del logo es fija por extensión: al cambiar de PNG a JPEG hay que
    // retirar el archivo anterior para no servir el viejo por accidente.
    await this.storage.eliminar(claveAnterior).catch(() => undefined);
  }

  /** Quita el logo de la base y los archivos de ambas extensiones. */
  async quitarLogo(tenantId: string): Promise<void> {
    await this.exigirTenant(tenantId);
    await this.db.tenantConfig.upsert({
      where: { tenantId },
      update: { logoUrl: null },
      create: { tenantId, logoUrl: null },
    });
    await Promise.all(
      LOGO_EXTENSIONES.map((extension) =>
        this.storage.eliminar(this.claveLogo(tenantId, extension)).catch(() => undefined),
      ),
    );
  }

  /**
   * Logo para la ruta pública. Solo se sirve si `logoUrl` tiene la marca de
   * storage; en una ruta @Public el filtro de Prisma está apagado, así que el
   * `tenantId` se fija explícitamente a partir del slug.
   */
  async leerLogo(slug: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const tenant = await this.db.tenant.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!tenant) return null;

    const config = await this.db.tenantConfig.findUnique({
      where: { tenantId: tenant.id },
      select: { logoUrl: true },
    });
    if (config?.logoUrl !== LOGO_MARCA_STORAGE) return null;

    for (const extension of LOGO_EXTENSIONES) {
      try {
        const buffer = await this.storage.leer(tenant.id, this.claveLogo(tenant.id, extension));
        const mimeType = this.storage.firmarMime(buffer);
        if (mimeType === 'image/png' || mimeType === 'image/jpeg') {
          return { buffer, mimeType };
        }
      } catch (e) {
        // Un formato ausente es normal (el logo puede ser PNG o JPEG).
        if (!(e instanceof NotFoundException)) throw e;
      }
    }
    return null;
  }
}
