import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { SecuenciasService } from '../../core/secuencias/secuencias.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';
import type {
  CreateCitaDto,
  DisponibilidadQuery,
  ListarCitasQuery,
  UpdateCitaDto,
} from './citas.dto.js';

type CitaRow = Record<string, unknown> & {
  id: string;
  tenantId: string;
  fecha: Date | string;
  horaInicio: string;
  horaFin: string;
  estado: string;
  sedeId?: string | null;
  dentistaId?: string | null;
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
  sede: { findUnique: (a: unknown) => Promise<{ tenantId: string } | null> };
  membership: { findFirst: (a: unknown) => Promise<{ id: string; estado: string } | null> };
  tenantConfig: {
    findUnique: (a: unknown) => Promise<{ horario: unknown; descansos: unknown } | null>;
  };
};

/**
 * Forma del JSON `TenantConfig.horario` (Json?) soportada aquí:
 *
 *   {
 *     "lun": { "inicio": "09:00", "fin": "19:00" },
 *     "mar": { "inicio": "09:00", "fin": "19:00" },
 *     ...
 *     "dom": null            // sin atención ese día
 *   }
 *
 * Claves de día soportadas: `dom|lun|mar|mie|jue|vie|sab`.
 * Forma del JSON `TenantConfig.descansos` (Json?) soportada aquí:
 *
 *   [{ "desde": "2026-03-10", "hasta": "2026-03-12", "motivo": "Feriado" }]
 *
 * El rango es **inclusivo** en ambos extremos (día completo).
 */
type HorarioDia = { inicio?: string; fin?: string } | null;
type HorarioJson = Record<string, HorarioDia | undefined>;
type DescansoJson = { desde?: string; hasta?: string; motivo?: string };

const DIAS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'] as const;
/** Formas de día que pueden venir en `horario`: solo aceptamos este formato. */
const HORA_MIN = /^([01]\d|2[0-3]):[0-5]\d$/;
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Fecha civil (`YYYY-MM-DD`) y día de la semana de una columna `@db.Date`.
 *
 * Se leen en **UTC** y no en hora local, y esto no es un detalle: estas columnas
 * guardan la fecha civil como medianoche UTC. Leerlas con `getDate()`/`getDay()`
 * (locales) las desplaza un día en cualquier huso negativo —Lima es UTC-5—, así
 * que el 05/10/2026 (lunes) se leía como 04/10 (domingo). El efecto no era solo
 * un mensaje equivocado: el horario de atención se validaba contra el día
 * anterior, de modo que **un domingo se aceptaba** (validado como sábado) y un
 * lunes se rechazaba. Además, `iso` se comparaba con los rangos de `descansos`,
 * que también son fechas civiles.
 */
function partesFecha(fecha: Date | string): { iso: string; dia: string } {
  const d = new Date(fecha);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return { iso: `${d.getUTCFullYear()}-${mm}-${dd}`, dia: DIAS[d.getUTCDay()]! };
}

/** "09:30" -> minutos desde medianoche. */
export function aMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

/** Estados válidos de una cita (los del esquema). */
export const ESTADOS_CITA = [
  'pendiente',
  'confirmada',
  'recordatorio_enviado',
  'reprogramada',
  'cancelada',
  'realizada',
  'no_asistio',
] as const;

/** Motivo corto por el que una franja no está disponible. */
export type CodigoFranja = 'rango' | 'pasado' | 'horario' | 'descanso' | 'ocupado';

/**
 * Resultado de evaluar UNA franja contra las reglas del guardado.
 *
 * Es la ÚNICA fuente de verdad de las reglas de agenda: `crear` y
 * `actualizar` la usan para rechazar (lanzando) y `disponibilidad` para
 * informar (sin lanzar). Si la interfaz ofrece una hora que el guardado
 * rechaza, es peor que no ofrecer nada: por eso ambas usan esta función.
 */
export interface EvaluacionFranja {
  ok: boolean;
  codigo?: CodigoFranja;
  /** Mensaje explicativo (el mismo que devuelve el guardado). */
  motivo?: string;
}

export interface HuecoDisponibilidad {
  horaInicio: string;
  disponible: boolean;
  /** Solo cuando no está disponible: pasado | fuera de horario | descanso | ocupado. */
  motivo?: 'pasado' | 'fuera de horario' | 'descanso' | 'ocupado';
}

/** Rango máximo de `GET /citas` con `desde`/`hasta` (la vista de mes no puede traerse la clínica entera). */
export const MAX_DIAS_RANGO_CITAS = 62;

/** Rejilla de disponibilidad: pasos de 15 minutos. */
export const PASO_DISPONIBILIDAD_MIN = 15;

/**
 * Apertura y cierre por defecto cuando la clínica NO configuró horario.
 * Regla permisiva que ya existe y está probada: sin horario no se bloquea
 * nada, y la disponibilidad debe reflejarlo, no contradecirlo.
 */
const HORARIO_DEFECTO = { inicio: '07:00', fin: '21:00' };

function mismoDia(a: Date | string, b: Date | string): boolean {
  // En UTC, por el mismo motivo que `partesFecha`: comparar en local desplaza
  // ambas fechas por igual y suele coincidir, pero deja de ser correcto en cuanto
  // uno de los dos valores no es medianoche UTC.
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getUTCFullYear() === db.getUTCFullYear() &&
    da.getUTCMonth() === db.getUTCMonth() &&
    da.getUTCDate() === db.getUTCDate()
  );
}

/** Normaliza `TenantConfig.horario` (Json libre) a la forma documentada. */
function leerHorario(valor: unknown): HorarioJson | null {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null;
  return valor as HorarioJson;
}

/** Normaliza `TenantConfig.descansos` (Json libre) a la forma documentada. */
function leerDescansos(valor: unknown): DescansoJson[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter((d): d is DescansoJson => !!d && typeof d === 'object');
}

/** Minutos desde medianoche -> "HH:MM". */
function aTextoHora(minutos: number): string {
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
}

function motivoRango(horaInicio: string, horaFin: string): string | null {
  if (aMinutos(horaFin) <= aMinutos(horaInicio)) {
    return 'horaFin debe ser posterior a horaInicio';
  }
  return null;
}

/**
 * Franja que ya pasó.
 *
 * La cita ocurre en una **fecha civil** y una **hora local del consultorio**; la
 * fecha se guarda como medianoche UTC (columnas `@db.Date`), así que el instante
 * se reconstruye con las partes UTC de la fecha más la hora indicada, en la zona
 * del servidor (que es la del consultorio).
 *
 * Sin esta comprobación se podía agendar para hoy a las 11:00 cuando ya eran las
 * 22:00, y el usuario recibía un mensaje sobre el horario de atención en lugar
 * del motivo real.
 */
function motivoPasado(fecha: Date | string, horaInicio: string): string | null {
  const { iso } = partesFecha(fecha);
  const [y, m, d] = iso.split('-').map(Number);
  const [hh, mm] = horaInicio.split(':').map(Number);
  if (![y, m, d, hh, mm].every((n) => Number.isFinite(n))) return null;
  const inicio = new Date(y, m - 1, d, hh, mm);
  if (inicio.getTime() < Date.now()) {
    return `No se puede agendar en el pasado: la franja ${iso} ${horaInicio} ya pasó`;
  }
  return null;
}

/**
 * Horario de atención y descansos (`TenantConfig`, ver forma documentada
 * arriba). Decisión deliberada: si el tenant no tiene `TenantConfig`,
 * `horario` es null o el día no está definido, NO se bloquea (comportamiento
 * permisivo por defecto) para no dejar sin agenda a clínicas que aún no
 * configuraron su horario. Solo se rechaza cuando el horario existe y la cita
 * no cabe, o cuando la fecha cae en un descanso.
 */
function motivoHorario(
  cfg: { horario: unknown; descansos: unknown } | null,
  fecha: Date | string,
  horaInicio: string,
  horaFin: string,
): { codigo: 'horario' | 'descanso'; motivo: string } | null {
  if (!cfg) return null;

  const { iso, dia } = partesFecha(fecha);
  for (const d of leerDescansos(cfg.descansos)) {
    const desde = typeof d.desde === 'string' ? d.desde : undefined;
    const hasta = typeof d.hasta === 'string' ? d.hasta : undefined;
    if (!desde || !FECHA_ISO.test(desde)) continue;
    // Sin `hasta`, el descanso cubre solo el día `desde`.
    const finDescanso = hasta && FECHA_ISO.test(hasta) ? hasta : desde;
    if (iso >= desde && iso <= finDescanso) {
      const motivo = typeof d.motivo === 'string' && d.motivo ? `: ${d.motivo}` : '';
      return { codigo: 'descanso', motivo: `La fecha cae en un descanso del consultorio${motivo}` };
    }
  }

  const horario = leerHorario(cfg.horario);
  if (!horario) return null;
  const franja = horario[dia];
  if (franja === null || franja === undefined) {
    return { codigo: 'horario', motivo: `El consultorio no atiende el día ${dia}` };
  }
  const { inicio, fin } = franja;
  if (typeof inicio !== 'string' || typeof fin !== 'string') return null;
  if (!HORA_MIN.test(inicio) || !HORA_MIN.test(fin)) return null;
  if (aMinutos(horaInicio) < aMinutos(inicio) || aMinutos(horaFin) > aMinutos(fin)) {
    return {
      codigo: 'horario',
      motivo: `La cita está fuera del horario de atención (${dia} ${inicio}-${fin})`,
    };
  }
  return null;
}

/** Apertura y cierre del día según el horario configurado (null = permisivo). */
function franjaDelDia(
  horario: unknown,
  fecha: Date | string,
): { inicio: string; fin: string } | null {
  const h = leerHorario(horario);
  if (!h) return null;
  const { dia } = partesFecha(fecha);
  const f = h[dia];
  if (!f || typeof f.inicio !== 'string' || typeof f.fin !== 'string') return null;
  if (!HORA_MIN.test(f.inicio) || !HORA_MIN.test(f.fin)) return null;
  if (aMinutos(f.fin) <= aMinutos(f.inicio)) return null;
  return { inicio: f.inicio, fin: f.fin };
}

/** Código de fallo de `evaluarFranja` -> motivo corto de la rejilla. */
function motivoCorto(codigo: CodigoFranja | undefined): HuecoDisponibilidad['motivo'] {
  switch (codigo) {
    case 'pasado':
      return 'pasado';
    case 'descanso':
      return 'descanso';
    case 'ocupado':
      return 'ocupado';
    default:
      return 'fuera de horario';
  }
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

  async listar(q: ListarCitasQuery = {}): Promise<CitaRow[]> {
    requireTenant();
    const where: Record<string, unknown> = { deletedAt: null };
    if (q.fecha && (q.desde || q.hasta)) {
      throw new BadRequestException('fecha y el rango desde/hasta son excluyentes');
    }
    if (q.fecha) {
      where.fecha = new Date(`${q.fecha}T00:00:00.000Z`);
    } else if (q.desde || q.hasta) {
      const desde = q.desde ?? q.hasta!;
      const hasta = q.hasta ?? q.desde!;
      if (hasta < desde) {
        throw new BadRequestException('hasta no puede ser anterior a desde');
      }
      const dias =
        (Date.UTC(+hasta.slice(0, 4), +hasta.slice(5, 7) - 1, +hasta.slice(8, 10)) -
          Date.UTC(+desde.slice(0, 4), +desde.slice(5, 7) - 1, +desde.slice(8, 10))) /
        86_400_000;
      if (dias > MAX_DIAS_RANGO_CITAS) {
        throw new BadRequestException(
          `El rango máximo es de ${MAX_DIAS_RANGO_CITAS} días`,
        );
      }
      where.fecha = {
        gte: new Date(`${desde}T00:00:00.000Z`),
        lte: new Date(`${hasta}T00:00:00.000Z`),
      };
    }
    // Alcances opcionales con la MISMA verificación de pertenencia que el
    // guardado: filtrar por sede/dentista ajenos da 404, no datos vacíos.
    await this.verificarSede(q.sedeId);
    await this.verificarDentista(q.dentistaId);
    if (q.sedeId) where.sedeId = q.sedeId;
    if (q.dentistaId) where.dentistaId = q.dentistaId;
    if (q.estado !== undefined) {
      if (!(ESTADOS_CITA as readonly string[]).includes(q.estado)) {
        throw new BadRequestException('Estado desconocido');
      }
      where.estado = q.estado;
    }
    return this.db.cita.findMany({
      where,
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
    // FKs opcionales: `sedeId`/`dentistaId` llegan del body; sin verificar
    // pertenencia permitirían agendar contra otra sede u otro tenant (404, no 403).
    const sedeId = dto.sedeId ?? ctx.sedeId ?? null;
    await this.verificarSede(sedeId);
    await this.verificarDentista(dto.dentistaId);
    const paciente = await this.db.paciente.findUnique({ where: { id: dto.pacienteId } });
    if (!paciente || paciente.tenantId !== ctx.tenantId) {
      throw new NotFoundException('Paciente no encontrado');
    }
    if (dto.tratamientoId) {
      const t = await this.db.tratamiento.findUnique({ where: { id: dto.tratamientoId } });
      if (!t || t.tenantId !== ctx.tenantId) throw new NotFoundException('Tratamiento no encontrado');
    }
    const fecha = new Date(dto.fecha);
    // Horario, descansos, pasado y solapamiento por la ÚNICA vía (ver
    // `evaluarFranja`): lo que el guardado rechaza, la disponibilidad lo marca.
    await this.exigirFranja({
      fecha,
      horaInicio: dto.horaInicio,
      horaFin: dto.horaFin,
      sedeId,
      dentistaId: dto.dentistaId ?? null,
    });
    const token = await this.secuencias.siguienteTokenCita();
    try {
      return await this.db.cita.create({
        data: {
          tenantId: ctx.tenantId,
          token,
          pacienteId: dto.pacienteId,
          tratamientoId: dto.tratamientoId ?? null,
          sedeId,
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
            sedeId,
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
    // `tratamientoId` también es FK opcional y editable.
    if (dto.tratamientoId) {
      const ctx = requireTenant();
      const t = await this.db.tratamiento.findUnique({ where: { id: dto.tratamientoId } });
      if (!t || t.tenantId !== ctx.tenantId) throw new NotFoundException('Tratamiento no encontrado');
    }
    const sedeId = actual.sedeId ?? null;
    const dentistaId = actual.dentistaId ?? null;
    if (dto.fecha || dto.horaInicio || dto.horaFin) {
      // Solo cuando se MUEVE la cita: cambiar el estado o la observación de una
      // cita pasada (marcarla como realizada) debe seguir funcionando.
      await this.exigirFranja({ fecha, horaInicio, horaFin, sedeId, dentistaId, excluirId: id });
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

  /**
   * Rejilla de disponibilidad de un día en pasos de 15 minutos.
   *
   * Usa la MISMA `evaluarFranja` que el guardado (invariante 2): cada hueco se
   * evalúa con las reglas reales (pasado, horario, descanso, solape). La
   * última hora de inicio permite la DURACIÓN COMPLETA antes del cierre (una
   * cita de 30 min no puede empezar a las 18:45 si cierra a las 19:00).
   * Alcance y aislamiento como el guardado: sede y odontólogo propios o 404.
   */
  async disponibilidad(q: DisponibilidadQuery): Promise<HuecoDisponibilidad[]> {
    const ctx = requireTenant();
    const sedeId = q.sedeId ?? ctx.sedeId ?? null;
    await this.verificarSede(sedeId);
    await this.verificarDentista(q.dentistaId);
    const dentistaId = q.dentistaId ?? null;

    const fecha = new Date(`${q.fecha}T00:00:00.000Z`);
    const cfg = await this.db.tenantConfig.findUnique({ where: { tenantId: ctx.tenantId } });
    const franja = franjaDelDia(cfg?.horario ?? null, fecha);
    const apertura = franja?.inicio ?? HORARIO_DEFECTO.inicio;
    const cierre = franja?.fin ?? HORARIO_DEFECTO.fin;

    const huecos: HuecoDisponibilidad[] = [];
    for (
      let ini = aMinutos(apertura);
      ini + q.duracion <= aMinutos(cierre);
      ini += PASO_DISPONIBILIDAD_MIN
    ) {
      const horaInicio = aTextoHora(ini);
      const horaFin = aTextoHora(ini + q.duracion);
      const ev = await this.evaluarFranja({ fecha, horaInicio, horaFin, sedeId, dentistaId });
      huecos.push(
        ev.ok
          ? { horaInicio, disponible: true }
          : { horaInicio, disponible: false, motivo: motivoCorto(ev.codigo) },
      );
    }
    return huecos;
  }

  /**
   * Evalúa UNA franja contra las reglas del guardado, en el MISMO orden
   * (rango → pasado → horario/descanso → solape) y con los MISMOS mensajes.
   * No lanza: devuelve el primer fallo para que el llamador decida (el
   * guardado lanza 400, la disponibilidad informa el motivo).
   */
  async evaluarFranja(args: {
    fecha: Date | string;
    horaInicio: string;
    horaFin: string;
    sedeId?: string | null;
    dentistaId?: string | null;
    excluirId?: string;
  }): Promise<EvaluacionFranja> {
    const { fecha, horaInicio, horaFin } = args;
    const rango = motivoRango(horaInicio, horaFin);
    if (rango) return { ok: false, codigo: 'rango', motivo: rango };
    const pasado = motivoPasado(fecha, horaInicio);
    if (pasado) return { ok: false, codigo: 'pasado', motivo: pasado };
    const ctx = requireTenant();
    const cfg = await this.db.tenantConfig.findUnique({ where: { tenantId: ctx.tenantId } });
    const horario = motivoHorario(cfg, fecha, horaInicio, horaFin);
    if (horario) return { ok: false, codigo: horario.codigo, motivo: horario.motivo };
    const ocupado = await this.haySolapamiento(
      fecha,
      horaInicio,
      horaFin,
      { sedeId: args.sedeId, dentistaId: args.dentistaId },
      args.excluirId,
    );
    if (ocupado) {
      return { ok: false, codigo: 'ocupado', motivo: 'La cita se solapa con otra existente' };
    }
    return { ok: true };
  }

  /** `evaluarFranja` que lanza 400 con el mensaje (lo que usan crear/actualizar). */
  private async exigirFranja(args: {
    fecha: Date | string;
    horaInicio: string;
    horaFin: string;
    sedeId?: string | null;
    dentistaId?: string | null;
    excluirId?: string;
  }): Promise<void> {
    const ev = await this.evaluarFranja(args);
    if (!ev.ok) throw new BadRequestException(ev.motivo);
  }

  /** `sedeId` (body o contexto) debe existir y pertenecer al tenant: si no, 404. */
  private async verificarSede(sedeId: string | null | undefined): Promise<void> {
    if (!sedeId) return;
    const ctx = requireTenant();
    const sede = await this.db.sede.findUnique({ where: { id: sedeId } });
    if (!sede || sede.tenantId !== ctx.tenantId) throw new NotFoundException('Sede no encontrada');
  }

  /**
   * `dentistaId` es el id de una `Membership` (odontoólogo) del tenant y debe
   * estar ACTIVA: si no, 404. No se exige que la sede de la membresía coincida
   * con la de la cita (un profesional puede atender en varias sedes).
   */
  private async verificarDentista(dentistaId: string | null | undefined): Promise<void> {
    if (!dentistaId) return;
    const ctx = requireTenant();
    const m = await this.db.membership.findFirst({
      where: { id: dentistaId, tenantId: ctx.tenantId, estado: 'ACTIVE' },
    });
    if (!m) throw new NotFoundException('Dentista no encontrado');
  }

  /**
   * Bloqueador #4: antes solo se comparaba `hora` exacta; ahora rango explícito.
   * El alcance es por recurso: se ignoran las citas borradas, y si la cita tiene
   * `dentistaId`/`sedeId` solo colisiona contra ese mismo odontólogo o esa misma
   * sede (dos odontólogos o dos sedes distintas sí pueden coincidir en hora).
   */
  private async haySolapamiento(
    fecha: Date | string,
    horaInicio: string,
    horaFin: string,
    recurso: { sedeId?: string | null; dentistaId?: string | null },
    excluirId?: string,
  ): Promise<boolean> {
    const inicio = aMinutos(horaInicio);
    const fin = aMinutos(horaFin);
    const delDia = await this.db.cita.findMany({
      where: {
        fecha: new Date(fecha as string),
        deletedAt: null,
        ...(recurso.sedeId ? { sedeId: recurso.sedeId } : {}),
        ...(recurso.dentistaId ? { dentistaId: recurso.dentistaId } : {}),
      },
    });
    for (const c of delDia) {
      if (excluirId && c.id === excluirId) continue;
      if (c.estado === 'cancelada') continue;
      if (!mismoDia(c.fecha, fecha)) continue;
      const ci = aMinutos(c.horaInicio);
      const cf = aMinutos(c.horaFin);
      if (inicio < cf && ci < fin) return true;
    }
    return false;
  }
}
