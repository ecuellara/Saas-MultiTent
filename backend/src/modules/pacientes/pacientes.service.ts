import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
    return this.db.documentoPaciente.findMany({ where: { pacienteId: id, deletedAt: null } });
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

  async descarga(id: string, docId: string): Promise<Record<string, unknown>> {
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
    // Defensa en profundidad: revalida la clave almacenada antes de entregarla.
    this.storage.assertClaveTenant(ctx.tenantId, doc.storageKey as string);
    return doc;
  }

  async odontogramas(id: string): Promise<unknown> {
    await this.obtener(id);
    return this.db.odontograma.findMany({ where: { pacienteId: id } });
  }
}
