import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { SecuenciasService } from '../../core/secuencias/secuencias.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';
import type { CreateCitaDto, UpdateCitaDto } from './citas.dto.js';

type CitaRow = Record<string, unknown> & {
  id: string;
  tenantId: string;
  fecha: Date | string;
  horaInicio: string;
  horaFin: string;
  estado: string;
};

type Db = {
  cita: {
    findUnique: (a: unknown) => Promise<CitaRow | null>;
    findMany: (a: unknown) => Promise<CitaRow[]>;
    create: (a: unknown) => Promise<CitaRow>;
    update: (a: unknown) => Promise<CitaRow>;
  };
  paciente: { findUnique: (a: unknown) => Promise<{ tenantId: string } | null> };
  tratamiento: { findUnique: (a: unknown) => Promise<{ tenantId: string } | null> };
};

/** "09:30" -> minutos desde medianoche. */
export function aMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

function mismoDia(a: Date | string, b: Date | string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

@Injectable()
export class CitasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secuencias: SecuenciasService,
  ) {}

  private get db(): Db {
    return this.prisma as unknown as Db;
  }

  async listar(fecha?: string): Promise<CitaRow[]> {
    requireTenant();
    return this.db.cita.findMany({
      where: { ...(fecha ? { fecha: new Date(fecha) } : {}), deletedAt: null },
      orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
    });
  }

  async obtener(id: string): Promise<CitaRow> {
    const ctx = requireTenant();
    const c = await this.db.cita.findUnique({ where: { id } });
    if (!c || c.tenantId !== ctx.tenantId) throw new NotFoundException('Cita no encontrada');
    return c;
  }

  async crear(dto: CreateCitaDto): Promise<CitaRow> {
    const ctx = requireTenant();
    this.validarRango(dto.horaInicio, dto.horaFin);
    const paciente = await this.db.paciente.findUnique({ where: { id: dto.pacienteId } });
    if (!paciente || paciente.tenantId !== ctx.tenantId) {
      throw new NotFoundException('Paciente no encontrado');
    }
    if (dto.tratamientoId) {
      const t = await this.db.tratamiento.findUnique({ where: { id: dto.tratamientoId } });
      if (!t || t.tenantId !== ctx.tenantId) throw new NotFoundException('Tratamiento no encontrado');
    }
    const fecha = new Date(dto.fecha);
    await this.verificarSolapamiento(fecha, dto.horaInicio, dto.horaFin);
    const token = await this.secuencias.siguienteTokenCita();
    try {
      return await this.db.cita.create({
        data: {
          tenantId: ctx.tenantId,
          token,
          pacienteId: dto.pacienteId,
          tratamientoId: dto.tratamientoId ?? null,
          sedeId: dto.sedeId ?? ctx.sedeId ?? null,
          dentistaId: dto.dentistaId ?? null,
          fecha,
          horaInicio: dto.horaInicio,
          horaFin: dto.horaFin,
          observacion: dto.observacion ?? null,
        },
      });
    } catch (e) {
      // Colisión de token (único por tenant): reintenta una vez.
      if (e instanceof Error && 'code' in e && (e as { code: string }).code === 'P2002') {
        const token2 = await this.secuencias.siguienteTokenCita();
        return this.db.cita.create({
          data: {
            tenantId: ctx.tenantId,
            token: token2,
            pacienteId: dto.pacienteId,
            tratamientoId: dto.tratamientoId ?? null,
            sedeId: dto.sedeId ?? ctx.sedeId ?? null,
            dentistaId: dto.dentistaId ?? null,
            fecha,
            horaInicio: dto.horaInicio,
            horaFin: dto.horaFin,
            observacion: dto.observacion ?? null,
          },
        });
      }
      throw e;
    }
  }

  async actualizar(id: string, dto: UpdateCitaDto): Promise<CitaRow> {
    const actual = await this.obtener(id);
    const fecha = dto.fecha ? new Date(dto.fecha) : actual.fecha;
    const horaInicio = dto.horaInicio ?? actual.horaInicio;
    const horaFin = dto.horaFin ?? actual.horaFin;
    this.validarRango(horaInicio, horaFin);
    if (dto.fecha || dto.horaInicio || dto.horaFin) {
      await this.verificarSolapamiento(fecha, horaInicio, horaFin, id);
    }
    const { tenantId: _ignored, ...resto } = dto as Record<string, unknown>;
    return this.db.cita.update({
      where: { id },
      data: { ...resto, ...(dto.fecha ? { fecha: new Date(dto.fecha) } : {}) },
    });
  }

  async cancelar(id: string): Promise<CitaRow> {
    await this.obtener(id);
    return this.db.cita.update({ where: { id }, data: { estado: 'cancelada' } });
  }

  private validarRango(horaInicio: string, horaFin: string): void {
    if (aMinutos(horaFin) <= aMinutos(horaInicio)) {
      throw new BadRequestException('horaFin debe ser posterior a horaInicio');
    }
  }

  /** Bloqueador #4: antes solo se comparaba `hora` exacta; ahora rango explícito. */
  private async verificarSolapamiento(
    fecha: Date | string,
    horaInicio: string,
    horaFin: string,
    excluirId?: string,
  ): Promise<void> {
    const inicio = aMinutos(horaInicio);
    const fin = aMinutos(horaFin);
    const delDia = await this.db.cita.findMany({ where: { fecha: new Date(fecha as string) } });
    for (const c of delDia) {
      if (excluirId && c.id === excluirId) continue;
      if (c.estado === 'cancelada') continue;
      if (!mismoDia(c.fecha, fecha)) continue;
      const ci = aMinutos(c.horaInicio);
      const cf = aMinutos(c.horaFin);
      if (inicio < cf && ci < fin) {
        throw new BadRequestException('La cita se solapa con otra existente');
      }
    }
  }
}
