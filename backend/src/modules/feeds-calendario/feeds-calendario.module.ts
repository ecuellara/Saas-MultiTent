import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { Public } from '../../core/auth/public.decorator.js';
import { LimitadorIntentos, claveIp } from '../../core/auth/rate-limit.js';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';
import {
  construirIcs,
  ventanaFeedCivil,
  type CitaParaIcs,
} from './calendario-ics.js';

/**
 * Feeds ICS suscribibles (sin OAuth; la vía OAuth queda documentada como etapa
 * futura en `docs/calendario-oauth-futuro.md` y NO se implementa aquí).
 *
 * Dos piezas:
 * - `FeedsCalendarioController` (`/api/feeds-calendario`): gestión autenticada
 *   del feed (crear, ver URL, desactivar, regenerar). Listar exige permiso de
 *   la clínica: el token es un secreto y jamás se expone sin sesión.
 * - `AgendaIcsController` (`/api/agenda/:token.ics`): descarga PÚBLICA de solo
 *   lectura. Un cliente de calendario no puede autenticarse, así que la
 *   autenticación ES el token y el aislamiento sale de él (el feed solo
 *   contiene citas del tenant del feed).
 *
 * Permisos: leer la agenda (`appointments.read`) para ver los feeds y
 * gestionarlos con `appointments.write` (el odontólogo debe poder suscribir SU
 * agenda sin ser administrador). El aislamiento entre clínicas lo impone el
 * `tenantId` del contexto, igual que en `CitasService`.
 */

export class CrearFeedDto {
  /** null/omitido = toda la clínica. */
  @IsOptional()
  @IsString()
  sedeId?: string;

  /** Id de `Membership` del odontólogo; null/omitido = todas las agendas. */
  @IsOptional()
  @IsString()
  dentistaId?: string;
}

export class ActualizarFeedDto {
  @IsBoolean()
  activo!: boolean;
}

type FeedRow = {
  id: string;
  tenantId: string;
  sedeId: string | null;
  dentistaId: string | null;
  token: string;
  activo: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type Db = {
  feedCalendario: {
    findUnique: (a: unknown) => Promise<FeedRow | null>;
    findMany: (a: unknown) => Promise<FeedRow[]>;
    create: (a: unknown) => Promise<FeedRow>;
    update: (a: unknown) => Promise<FeedRow>;
    delete: (a: unknown) => Promise<FeedRow>;
  };
  cita: { findMany: (a: unknown) => Promise<CitaIcsRow[]> };
  sede: {
    findUnique: (a: unknown) => Promise<{ tenantId: string; nombre: string } | null>;
    findMany: (a: unknown) => Promise<Array<{ id: string; nombre: string }>>;
  };
  membership: {
    findFirst: (a: unknown) => Promise<{ id: string; userId: string } | null>;
  };
  tenant: { findUnique: (a: unknown) => Promise<{ nombre: string } | null> };
  user: { findUnique: (a: unknown) => Promise<{ nombre: string } | null> };
};

/** Fila de cita con las relaciones mínimas que necesita el ICS (nada clínico). */
type CitaIcsRow = {
  id: string;
  fecha: Date | string;
  horaInicio: string;
  horaFin: string;
  estado: string;
  token: string;
  paciente: { nombres: string; apellidos: string };
  tratamiento: { nombre: string } | null;
  /** `Cita` no tiene relación Prisma con `Sede`: el nombre se resuelve aparte. */
  sedeId: string | null;
};

/** 32 bytes aleatorios en base64url (256 bits): el token es impredecible. */
function nuevoTokenFeed(): string {
  return randomBytes(32).toString('base64url');
}

/** Límite configurable por entorno, con el valor estricto por defecto. */
function limiteIcsPorHora(): number {
  const v = Number(process.env.RATE_LIMIT_ICS);
  return Number.isFinite(v) && v > 0 ? v : 120;
}

@Injectable()
export class FeedsCalendarioService {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): Db {
    return this.prisma as unknown as Db;
  }

  async listar(): Promise<FeedRow[]> {
    requireTenant();
    return this.db.feedCalendario.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async crear(dto: CrearFeedDto): Promise<FeedRow> {
    const ctx = requireTenant();
    await this.verificarSede(dto.sedeId);
    await this.verificarDentista(dto.dentistaId);
    return this.db.feedCalendario.create({
      data: {
        tenantId: ctx.tenantId,
        sedeId: dto.sedeId ?? null,
        dentistaId: dto.dentistaId ?? null,
        token: nuevoTokenFeed(),
      },
    });
  }

  /** Revoca el token actual y entrega uno nuevo (la URL vieja deja de funcionar). */
  async regenerar(id: string): Promise<FeedRow> {
    await this.obtenerPropio(id);
    return this.db.feedCalendario.update({ where: { id }, data: { token: nuevoTokenFeed() } });
  }

  async actualizar(id: string, dto: ActualizarFeedDto): Promise<FeedRow> {
    await this.obtenerPropio(id);
    return this.db.feedCalendario.update({ where: { id }, data: { activo: dto.activo } });
  }

  async eliminar(id: string): Promise<void> {
    await this.obtenerPropio(id);
    await this.db.feedCalendario.delete({ where: { id } });
  }

  /**
   * Sirve el ICS de un feed a partir de SU token (ruta pública, sin sesión).
   * Puro de solo lectura: no escribe nada en ninguna tabla.
   */
  async servirFeed(token: string): Promise<{ nombre: string; cuerpo: string }> {
    const feed = await this.db.feedCalendario.findUnique({ where: { token } });
    // Mismo 404 para token inexistente e inactivo: no se revela cuál es cuál.
    if (!feed || !feed.activo) throw new NotFoundException('Feed no encontrado');

    const { desde, hasta } = ventanaFeedCivil();
    const citas = await this.db.cita.findMany({
      where: {
        // Aislamiento: el feed solo puede contener citas de SU clínica. El
        // contexto aquí NO está validado (ruta `@Public()`), así que la
        // extensión Prisma no filtra: el `tenantId` se fija explícitamente.
        tenantId: feed.tenantId,
        deletedAt: null,
        estado: { not: 'cancelada' },
        fecha: { gte: new Date(`${desde}T00:00:00.000Z`), lte: new Date(`${hasta}T00:00:00.000Z`) },
        ...(feed.sedeId ? { sedeId: feed.sedeId } : {}),
        ...(feed.dentistaId ? { dentistaId: feed.dentistaId } : {}),
      },
      // Selección explícita y mínima: el ICS jamás expone ids de otras
      // clínicas, importes, notas clínicas ni observaciones (podrían contener
      // datos clínicos).
      select: {
        id: true,
        fecha: true,
        horaInicio: true,
        horaFin: true,
        estado: true,
        token: true,
        sedeId: true,
        paciente: { select: { nombres: true, apellidos: true } },
        tratamiento: { select: { nombre: true } },
      },
      orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
    });

    // `Cita.sedeId` es columna suelta (sin relación Prisma): mapa id → nombre
    // acotado al tenant del feed.
    const sedes = await this.db.sede.findMany({ where: { tenantId: feed.tenantId } });
    const nombreSede = new Map(sedes.map((s) => [s.id, s.nombre]));

    const paraIcs: CitaParaIcs[] = citas.map((c) => ({
      id: c.id,
      fecha: c.fecha,
      horaInicio: c.horaInicio,
      horaFin: c.horaFin,
      estado: c.estado,
      pacienteNombre: `${c.paciente.apellidos}, ${c.paciente.nombres}`,
      tratamientoNombre: c.tratamiento?.nombre ?? null,
      sedeNombre: (c.sedeId && nombreSede.get(c.sedeId)) || null,
      tokenCita: c.token,
    }));

    const tenant = await this.db.tenant.findUnique({ where: { id: feed.tenantId } });
    const nombre = `Agenda ${tenant?.nombre ?? 'clínica'}`;
    return { nombre, cuerpo: construirIcs(nombre, paraIcs) };
  }

  /** Feed del propio tenant o 404 (nunca 403: no revela la existencia ajena). */
  private async obtenerPropio(id: string): Promise<FeedRow> {
    const ctx = requireTenant();
    const f = await this.db.feedCalendario.findUnique({ where: { id } });
    if (!f || f.tenantId !== ctx.tenantId) throw new NotFoundException('Feed no encontrado');
    return f;
  }

  private async verificarSede(sedeId: string | null | undefined): Promise<void> {
    if (!sedeId) return;
    const ctx = requireTenant();
    const sede = await this.db.sede.findUnique({ where: { id: sedeId } });
    if (!sede || sede.tenantId !== ctx.tenantId) throw new NotFoundException('Sede no encontrada');
  }

  private async verificarDentista(dentistaId: string | null | undefined): Promise<void> {
    if (!dentistaId) return;
    const ctx = requireTenant();
    const m = await this.db.membership.findFirst({
      where: { id: dentistaId, tenantId: ctx.tenantId, estado: 'ACTIVE' },
    });
    if (!m) throw new NotFoundException('Dentista no encontrado');
  }
}

@ApiTags('feeds-calendario')
@Controller('feeds-calendario')
export class FeedsCalendarioController {
  constructor(private readonly service: FeedsCalendarioService) {}

  @Get()
  @RequirePermission('appointments.read')
  listar(): Promise<FeedRow[]> {
    return this.service.listar();
  }

  @Post()
  @RequirePermission('appointments.write')
  crear(@Body() dto: CrearFeedDto): Promise<FeedRow> {
    return this.service.crear(dto);
  }

  @Post(':id/regenerar')
  @RequirePermission('appointments.write')
  regenerar(@Param('id') id: string): Promise<FeedRow> {
    return this.service.regenerar(id);
  }

  @Patch(':id')
  @RequirePermission('appointments.write')
  actualizar(@Param('id') id: string, @Body() dto: ActualizarFeedDto): Promise<FeedRow> {
    return this.service.actualizar(id, dto);
  }

  @Delete(':id')
  @RequirePermission('appointments.write')
  async eliminar(@Param('id') id: string): Promise<{ ok: true }> {
    await this.service.eliminar(id);
    return { ok: true };
  }
}

/**
 * Descarga pública del feed (`GET /api/agenda/:token.ics`).
 *
 * `@Public()` salta los cuatro guards (JWT, tenant, permisos, features): un
 * cliente de calendario no puede autenticarse. La autenticación es el token y
 * el aislamiento sale de él. Solo lectura: es un GET que no escribe nada.
 */
@ApiTags('agenda')
@Controller('agenda')
export class AgendaIcsController {
  /**
   * Límite por feed (Google consulta cada pocas horas, no cada minuto).
   * Comparte la ventana de 1 min de autenticación solo como unidad; el límite
   * efectivo es por hora. En memoria por instancia (igual que el de login).
   */
  private readonly limitador = new LimitadorIntentos(60 * 60_000);

  constructor(private readonly service: FeedsCalendarioService) {}

  @Public()
  @Get(':token')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  async descargar(
    @Param('token') tokenConSufijo: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    // Acepta `:token` con o sin el sufijo `.ics` (la ruta documentada lo lleva).
    const token = tokenConSufijo.endsWith('.ics')
      ? tokenConSufijo.slice(0, -'.ics'.length)
      : tokenConSufijo;
    this.limitador.consumir(
      [
        {
          clave: `ics:${claveIp(res.req?.ip)}:${token.slice(0, 16)}`,
          limite: limiteIcsPorHora(),
          ventanaMs: 60 * 60_000,
          etiqueta: 'feed',
        },
      ],
      'Demasiadas consultas al feed. Vuelva a intentarlo más tarde.',
    );
    const { cuerpo } = await this.service.servirFeed(token);
    res.setHeader('Content-Disposition', 'inline; filename="agenda.ics"');
    // Sin caché agresiva: el calendario debe volver a consultar el feed.
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    return cuerpo;
  }
}

@Module({
  controllers: [FeedsCalendarioController, AgendaIcsController],
  providers: [FeedsCalendarioService],
})
export class FeedsCalendarioModule {}
