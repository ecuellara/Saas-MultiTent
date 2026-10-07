/**
 * Auditoría (doc §10): corrección de los bugs diagnosticados en el
 * `AuditInterceptor` y en el login de plataforma.
 *
 * Cobertura:
 *  1. Una mutación exitosa deja `resultado: 'SUCCESS'`.
 *  2. Una petición que falla (401 y 400) deja `resultado: 'FAILURE'` — antes
 *     quedaba registrada como SUCCESS salvo 404/403.
 *  3. La fila de una mutación guarda `datosNuevos` (instantánea del cuerpo),
 *     redactado: sin claves sensibles y con las cadenas largas truncadas.
 *  4. La fila guarda también la IMAGEN PREVIA (`datosAnteriores`): el estado
 *     ANTERIOR de la fila, leído por el propio interceptor antes del handler.
 *     Se comprueba contra la fila real en un `PATCH` y en la baja lógica
 *     (`DELETE`), que un recurso de OTRO tenant no deja ni un dato, y que la
 *     imagen pasa por la MISMA redacción (columnas sensibles del modelo).
 *  5. El login de plataforma (`/platform/auth/*`, ruta `@Public`) deja fila en
 *     `PlatformAuditLog`.
 */
import { ForbiddenException, INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { montarAppE2E } from './helpers/app.e2e.js';
import { AuditInterceptor, CrossTenantError } from '../src/core/audit/audit.interceptor.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import {
  tenantContext,
  type TenantStore,
} from '../src/core/tenant-context/tenant-context.js';
import { loginPlataformaConMfa } from './helpers/platform-login.js';
import { PASSWORD_PLAIN, limpiarDosTenants, seedDosTenants, type DosTenants } from './helpers/tenants-fixture.js';

const EMAIL_PLATAFORMA = 'auditoria-owner@test.pe';
const PASSWORD_PLATAFORMA = 'Auditoria-Owner-2026!!';
const SECRETO_EN_CLARO = 'Secreto-Que-No-Debe-Auditarse-2026';
/** Claves que NUNCA deben aparecer en `Auditoria.datosNuevos`/`datosAnteriores`. */
const CLAVES_PROHIBIDAS = [
  'password',
  'passwordHash',
  'clave',
  'actual',
  'nueva',
  'mfaSecret',
  'temp_token',
  'refreshToken',
  'access_token',
  'storageKey',
  'datosSnapshot',
  'cuerpoSnapshot',
];

interface FilaAuditoria {
  id: string;
  tenantId: string | null;
  tabla: string;
  registroId: string;
  accion: string;
  usuarioId: string | null;
  resultado: string;
  datosAnteriores: unknown;
  datosNuevos: unknown;
  createdAt: Date;
}

interface FilaPlatformAudit {
  id: string;
  platformUserId: string;
  accion: string;
  recurso: string;
  metadata: unknown;
}

interface Db {
  auditoria: {
    findMany: (a: unknown) => Promise<FilaAuditoria[]>;
    findFirst: (a: unknown) => Promise<FilaAuditoria | null>;
  };
  platformAuditLog: {
    findFirst: (a: unknown) => Promise<FilaPlatformAudit | null>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  platformUser: {
    create: (a: unknown) => Promise<{ id: string }>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  // Lecturas directas (sin pasar por la API) para comparar la imagen previa
  // contra el estado REAL de la fila antes y después de la mutación.
  paciente: { findUnique: (a: unknown) => Promise<Record<string, unknown> | null> };
  consentimientoFirmado: { findUnique: (a: unknown) => Promise<Record<string, unknown> | null> };
}

type Redactar = (valor: unknown, profundidad: number) => unknown;

/** Acceso al método privado de redacción (la prueba vive fuera de la clase). */
function redactarDe(interceptor: AuditInterceptor): Redactar {
  const proto = Object.getPrototypeOf(interceptor) as { redactar: Redactar };
  return proto.redactar.bind(interceptor);
}

type ImagenPrevia = (req: Record<string, unknown>) => Promise<Record<string, unknown> | null>;

/** Acceso al método privado que captura la imagen previa. */
function imagenPreviaDe(interceptor: AuditInterceptor): ImagenPrevia {
  const proto = Object.getPrototypeOf(interceptor) as { imagenPreviaDe: ImagenPrevia };
  return proto.imagenPreviaDe.bind(interceptor);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Espera a que el interceptor termine de escribir la fila: la escritura es
 * fire-and-forget a propósito (un fallo de auditoría no rompe la petición).
 */
async function esperarAuditoria(
  db: Db,
  where: Record<string, unknown>,
  timeoutMs = 5_000,
): Promise<FilaAuditoria | null> {
  const limite = Date.now() + timeoutMs;
  let fila: FilaAuditoria | null = null;
  while (Date.now() < limite) {
    fila = await db.auditoria.findFirst({ where, orderBy: { createdAt: 'desc' } });
    if (fila) return fila;
    await sleep(50);
  }
  return fila;
}

async function esperarPlatformAudit(
  db: Db,
  where: Record<string, unknown>,
  timeoutMs = 5_000,
): Promise<FilaPlatformAudit | null> {
  const limite = Date.now() + timeoutMs;
  let fila: FilaPlatformAudit | null = null;
  while (Date.now() < limite) {
    fila = await db.platformAuditLog.findFirst({ where, orderBy: { createdAt: 'desc' } });
    if (fila) return fila;
    await sleep(50);
  }
  return fila;
}

describe('Auditoría (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: Db;
  let datos: DosTenants;
  let adminH: Record<string, string>;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await montarAppE2E(modulo);
    prisma = app.get(PrismaService);
    db = prisma as unknown as Db;

    await limpiarDosTenants(prisma);
    // La FK de PlatformAuditLog → PlatformUser obliga a borrar los logs primero.
    await db.platformAuditLog.deleteMany({ where: { usuario: { email: EMAIL_PLATAFORMA } } });
    await db.platformUser.deleteMany({ where: { email: EMAIL_PLATAFORMA } });

    datos = await seedDosTenants(prisma);
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: datos.a.userEmail, password: PASSWORD_PLAIN })
      .expect(200);
    adminH = { Authorization: `Bearer ${login.body.access_token}`, 'X-Tenant-Id': datos.a.tenantId };
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      await limpiarDosTenants(prisma);
      await db.platformAuditLog.deleteMany({ where: { usuario: { email: EMAIL_PLATAFORMA } } });
      await db.platformUser.deleteMany({ where: { email: EMAIL_PLATAFORMA } });
    }
    if (app) await app.close();
  });

  it('una mutación exitosa se audita como SUCCESS con datosNuevos y la imagen previa', async () => {
    const srv = app.getHttpServer();
    const desde = new Date();
    // Estado ANTERIOR real, leído de la BD: la imagen previa debe reproducirlo.
    const antes = await db.paciente.findUnique({ where: { id: datos.a.pacienteId } });
    expect(antes, 'el fixture no dejó el paciente de A').toBeTruthy();

    await request(srv)
      .patch(`/api/pacientes/${datos.a.pacienteId}`)
      .set(adminH)
      .send({ telefono: '988777666' })
      .expect(200);

    const fila = await esperarAuditoria(db, {
      tenantId: datos.a.tenantId,
      registroId: datos.a.pacienteId,
      resultado: 'SUCCESS',
      createdAt: { gte: desde },
    });
    expect(fila, 'sin fila de auditoría para el PATCH exitoso').toBeTruthy();
    expect(fila!.accion).toBe(`PATCH /api/pacientes/${datos.a.pacienteId}`);
    expect(fila!.usuarioId).toBe(datos.a.userId);
    // Bug 2: `datosNuevos` existía en el modelo y nunca se escribía.
    expect(fila!.datosNuevos).not.toBeNull();
    const datosNuevos = fila!.datosNuevos as Record<string, unknown>;
    expect(datosNuevos.telefono).toBe('988777666');
    // Bug 1: `datosAnteriores` se quedaba siempre en `null` porque "no había
    // imagen previa sin tocar cada servicio". Ahora la captura el interceptor
    // ANTES del handler: el valor ANTERIOR y el nuevo conviven en la misma fila.
    expect(fila!.datosAnteriores, 'el PATCH no guardó la imagen previa').not.toBeNull();
    const datosAnteriores = fila!.datosAnteriores as Record<string, unknown>;
    expect(datosAnteriores.telefono).toBe(antes!.telefono);
    expect(datosAnteriores.telefono).not.toBe(datosNuevos.telefono);
    // Instantánea del registro completo (no solo del campo tocado).
    expect(datosAnteriores.id).toBe(datos.a.pacienteId);
    expect(datosAnteriores.tenantId).toBe(datos.a.tenantId);
    expect(datosAnteriores.nombres).toBe(antes!.nombres);
  });

  it('un login fallido se audita como FAILURE y sin tenant atribuido', async () => {
    const srv = app.getHttpServer();
    const desde = new Date();
    // El 401 lo lanza el SERVICIO (dentro del handler), así que el interceptor
    // sí lo ve. Es el caso que importaba: antes quedaba registrado como SUCCESS,
    // de modo que una fuerza bruta al login no dejaba rastro de fallo.
    //
    // NOTA (límite real, no del test): un 401 de `JwtAuthGuard` o un 403 de
    // `TenantGuard`/`PermissionsGuard` NO se auditan aquí, porque en Nest los
    // guards se ejecutan ANTES de los interceptores. Cubrirlos exige registrarlos
    // desde el propio guard.
    await request(srv)
      .post('/api/auth/login')
      .send({ email: datos.a.userEmail, password: 'Clave-Incorrecta-2026!' })
      .expect(401);

    const fila = await esperarAuditoria(db, {
      accion: 'POST /api/auth/login',
      resultado: 'FAILURE',
      createdAt: { gte: desde },
    });
    expect(fila, 'sin fila FAILURE para el login fallido').toBeTruthy();
    // Ruta @Public: el contexto no está validado, así que no se atribuye la
    // acción anónima a ningún tenant ni usuario.
    expect(fila!.tenantId).toBeNull();
    expect(fila!.usuarioId).toBeNull();
  });

  it('un 400 de validación se audita como FAILURE (no como SUCCESS)', async () => {
    const srv = app.getHttpServer();
    const desde = new Date();
    // `activo` debe ser booleano: falla el ValidationPipe antes del handler.
    await request(srv)
      .patch(`/api/pacientes/${datos.a.pacienteId}`)
      .set(adminH)
      .send({ activo: 'no-es-booleano' })
      .expect(400);

    const fila = await esperarAuditoria(db, {
      tenantId: datos.a.tenantId,
      registroId: datos.a.pacienteId,
      resultado: 'FAILURE',
      createdAt: { gte: desde },
    });
    expect(fila, 'sin fila FAILURE para el 400').toBeTruthy();
    expect(fila!.tabla).toBe('pacientes');
  });

  it('un 404 de recurso ajeno se audita como FAILURE sin persistir el cuerpo ni la imagen previa', async () => {
    const srv = app.getHttpServer();
    const desde = new Date();
    // Recurso de otro tenant: el servicio responde 404 (no revela existencia) y
    // el interceptor, al ser un error, lo registra como FAILURE.
    // OJO: el cuerpo debe ser VÁLIDO — con un campo desconocido el
    // `ValidationPipe` cortaría antes con 400 y nunca se llegaría al servicio.
    await request(srv)
      .patch(`/api/pacientes/${datos.b.pacienteId}`)
      .set(adminH)
      .send({ telefono: '955555555' })
      .expect(404);

    const fila = await esperarAuditoria(db, {
      tenantId: datos.a.tenantId,
      registroId: datos.b.pacienteId,
      resultado: 'FAILURE',
      createdAt: { gte: desde },
    });
    expect(fila, 'sin fila FAILURE para el recurso ajeno').toBeTruthy();
    // En un fallo NO se persiste ninguna instantánea del cuerpo: la redacción se
    // aplica a lo que sí se guarda, y aquí directamente no se guarda nada.
    expect(fila!.datosNuevos ?? null).toBeNull();
    // El interceptor lee la fila con `findUnique` por id, que NO pasa por la
    // extensión de aislamiento: la pertenencia al tenant del contexto validado
    // se comprueba antes de persistir. Si no coincide, no hay imagen previa.
    expect(fila!.datosAnteriores ?? null).toBeNull();
    // Ni un solo dato del paciente de B en la fila (el `registroId` es el id
    // consultado, no un dato del expediente ajeno).
    const pacienteB = await db.paciente.findUnique({ where: { id: datos.b.pacienteId } });
    expect(pacienteB, 'el fixture no dejó el paciente de B').toBeTruthy();
    const serializada = JSON.stringify(fila);
    expect(serializada).not.toContain(String(pacienteB!.numDoc));
    expect(serializada).not.toContain(String(pacienteB!.apellidos));
    expect(serializada).not.toContain(String(pacienteB!.nombres) + ' ' + String(pacienteB!.apellidos));
  });

  it('la imagen previa se redacta con la misma política y nunca cruza tenants', async () => {
    // `ConsentimientoFirmado` SÍ tiene columnas sensibles (`datosSnapshot`,
    // `cuerpoSnapshot`) y el fixture las rellena con texto reconocible: es el
    // caso real que demuestra que la imagen previa no se guarda en claro.
    //
    // Se ejercita `imagenPreviaDe` (la MISMA función que alimenta
    // `datosAnteriores`) contra la fila real de la BD y no vía HTTP a propósito:
    // la aserción global de "claves prohibidas" comprueba NOMBRES de clave y
    // `redactar` conserva la clave con valor `[REDACTADO]`, así que una fila de
    // consentimiento con esas claves haría fallar ese escaneo sin que haya
    // ningún secreto expuesto.
    const interceptor = new AuditInterceptor(prisma);
    const imagenPrevia = imagenPreviaDe(interceptor);
    // Contexto idéntico al que deja `TenantGuard` tras validar la membresía.
    const contextoA: TenantStore = {
      tenantId: datos.a.tenantId,
      userId: datos.a.userId,
      roleIds: [],
      permissions: [],
      validado: true,
    };

    const antes = await db.consentimientoFirmado.findUnique({
      where: { id: datos.a.consentimientoId },
    });
    expect(antes, 'el fixture no dejó el consentimiento de A').toBeTruthy();
    expect(String(antes!.cuerpoSnapshot)).toContain('Texto Paciente');

    const imagenA = await tenantContext.run(contextoA, () =>
      imagenPrevia({
        method: 'PATCH',
        originalUrl: `/api/consentimientos/${datos.a.consentimientoId}/estado`,
        params: { id: datos.a.consentimientoId },
      }),
    );
    expect(imagenA, 'sin imagen previa del consentimiento').toBeTruthy();
    // Misma función `redactar`: las columnas sensibles se sustituyen.
    expect(imagenA!.datosSnapshot).toBe('[REDACTADO]');
    expect(imagenA!.cuerpoSnapshot).toBe('[REDACTADO]');
    expect(imagenA!.pacienteId).toBe(datos.a.pacienteId);
    // El texto sensible del fixture no aparece en claro en la imagen previa.
    expect(JSON.stringify(imagenA)).not.toContain('Texto Paciente');

    // Fila de OTRO tenant: `findUnique` no filtra por la extensión, así que la
    // pertenencia se comprueba en el interceptor y la imagen se descarta.
    const imagenAjena = await tenantContext.run(contextoA, () =>
      imagenPrevia({
        method: 'PATCH',
        originalUrl: `/api/pacientes/${datos.b.pacienteId}`,
        params: { id: datos.b.pacienteId },
      }),
    );
    expect(imagenAjena ?? null).toBeNull();
  });

  it('el acceso cruzado se detecta por marca explícita y no por el código HTTP', () => {
    // El servicio de pacientes todavía lanza un 404 plano; cuando un servicio
    // adopte `CrossTenantError`, esta marca es lo que el interceptor reconoce.
    const interceptor = new AuditInterceptor(prisma);
    const esCruce = (
      Object.getPrototypeOf(interceptor) as { esAccesoCruzado: (e: unknown) => boolean }
    ).esAccesoCruzado.bind(interceptor);

    const cruzado = new CrossTenantError('paciente');
    expect(cruzado.getStatus(), 'el cruce debe seguir respondiendo 404').toBe(404);
    expect(cruzado.accesoCruzado).toBe(true);
    expect(esCruce(cruzado)).toBe(true);
    // Un 404 legítimo y un 403 de permisos NO son accesos cruzados: por eso la
    // detección no puede basarse en el status.
    expect(esCruce(new NotFoundException('Paciente no encontrado'))).toBe(false);
    expect(esCruce(new ForbiddenException('Sin permisos'))).toBe(false);
    expect(esCruce(undefined)).toBe(false);
  });

  it('ninguna fila de la tabla Auditoria filtra claves sensibles', async () => {
    const filas = await db.auditoria.findMany({
      where: { tenantId: datos.a.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, datosNuevos: true, datosAnteriores: true },
    });
    expect(filas.length, 'sin filas de auditoría para inspeccionar').toBeGreaterThan(0);
    // La imagen previa también se inspecciona aquí: antes era SIEMPRE `null`,
    // así que esta aserción garantiza que el escaneo no es vacío.
    expect(
      filas.some((f) => f.datosAnteriores !== null),
      'ninguna fila tiene imagen previa: el escaneo no cubriría `datosAnteriores`',
    ).toBe(true);
    for (const fila of filas) {
      const serializado = JSON.stringify({ n: fila.datosNuevos, a: fila.datosAnteriores });
      for (const prohibida of CLAVES_PROHIBIDAS) {
        expect(serializado.includes(`"${prohibida}"`), `fila ${fila.id} expone ${prohibida}`).toBe(false);
      }
      expect(serializado).not.toContain(SECRETO_EN_CLARO);
    }
  });

  it('la instantánea de auditoría redacta secretos y trunca cadenas largas', async () => {
    // `AuditInterceptor` no es un provider del contenedor (se registra como
    // APP_INTERCEPTOR), así que se instancia con el PrismaService de la app.
    const interceptor = new AuditInterceptor(prisma);
    const redactar = redactarDe(interceptor);
    const larga = 'A'.repeat(900);

    const instantanea = redactar(
      {
        telefono: '999000111',
        password: SECRETO_EN_CLARO,
        passwordHash: SECRETO_EN_CLARO,
        clave: SECRETO_EN_CLARO,
        actual: SECRETO_EN_CLARO,
        nueva: SECRETO_EN_CLARO,
        mfaSecret: SECRETO_EN_CLARO,
        temp_token: SECRETO_EN_CLARO,
        refreshToken: SECRETO_EN_CLARO,
        access_token: SECRETO_EN_CLARO,
        storageKey: SECRETO_EN_CLARO,
        datosSnapshot: { firma: SECRETO_EN_CLARO },
        cuerpoSnapshot: SECRETO_EN_CLARO,
        firmaPaciente: SECRETO_EN_CLARO,
        notas: larga,
      },
      0,
    ) as Record<string, unknown>;

    // Nada de lo prohibido sobrevive, ni siquiera en claro dentro de un anidado.
    for (const prohibida of [
      'password',
      'passwordHash',
      'clave',
      'actual',
      'nueva',
      'mfaSecret',
      'temp_token',
      'refreshToken',
      'access_token',
      'storageKey',
      'datosSnapshot',
      'cuerpoSnapshot',
      'firmaPaciente',
    ]) {
      expect(instantanea[prohibida], `${prohibida} no fue redactado`).toBe('[REDACTADO]');
    }
    expect(JSON.stringify(instantanea)).not.toContain(SECRETO_EN_CLARO);
    // Los campos legítimos se conservan y las cadenas enormes se truncan.
    expect(instantanea.telefono).toBe('999000111');
    const notas = instantanea.notas as string;
    expect(notas.startsWith('A'.repeat(500))).toBe(true);
    expect(notas).toContain('[TRUNCADO');
    expect(notas.length).toBeLessThan(larga.length);
  });

  it('el login de plataforma con MFA deja fila en PlatformAuditLog', async () => {
    const srv = app.getHttpServer();
    const hash = await bcrypt.hash(PASSWORD_PLATAFORMA, 10);
    const owner = await db.platformUser.create({
      data: {
        email: EMAIL_PLATAFORMA,
        passwordHash: hash,
        nombre: 'Owner Auditoría',
        rol: 'owner',
      },
    });

    const sesion = await loginPlataformaConMfa(srv, EMAIL_PLATAFORMA, PASSWORD_PLATAFORMA);
    expect(sesion.access).toBeTruthy();

    const fila = await esperarPlatformAudit(db, {
      platformUserId: owner.id,
      accion: 'POST /api/platform/auth/login',
    });
    expect(fila, 'el login de plataforma no dejó fila en PlatformAuditLog').toBeTruthy();
    expect(fila!.recurso).toBe('platformUser');
    expect((fila!.metadata as { resultado?: string } | null)?.resultado).toBe('SUCCESS');
  });

  // Último a propósito: da de baja al paciente de A, que los casos anteriores
  // usan para el PATCH.
  it('la baja lógica del paciente guarda la imagen previa y deja deletedAt', async () => {
    const srv = app.getHttpServer();
    const desde = new Date();
    const antes = await db.paciente.findUnique({ where: { id: datos.a.pacienteId } });
    expect(antes, 'el fixture no dejó el paciente de A').toBeTruthy();
    expect(antes!.deletedAt ?? null, 'el paciente de A ya estaba dado de baja').toBeNull();

    await request(srv).delete(`/api/pacientes/${datos.a.pacienteId}`).set(adminH).expect(200);

    const fila = await esperarAuditoria(db, {
      tenantId: datos.a.tenantId,
      registroId: datos.a.pacienteId,
      resultado: 'SUCCESS',
      createdAt: { gte: desde },
    });
    expect(fila, 'sin fila de auditoría para el DELETE').toBeTruthy();
    expect(fila!.accion).toBe(`DELETE /api/pacientes/${datos.a.pacienteId}`);
    const datosAnteriores = fila!.datosAnteriores as Record<string, unknown> | null;
    expect(datosAnteriores, 'la baja lógica no guardó la imagen previa').not.toBeNull();
    // Imagen del paciente BORRADO, campo a campo contra la fila real.
    expect(datosAnteriores!.nombres).toBe(antes!.nombres);
    expect(datosAnteriores!.apellidos).toBe(antes!.apellidos);
    expect(datosAnteriores!.numDoc).toBe(antes!.numDoc);
    expect(datosAnteriores!.telefono).toBe(antes!.telefono);
    // Estado ANTERIOR: todavía no estaba dado de baja.
    expect(datosAnteriores!.deletedAt ?? null).toBeNull();

    // La baja es LÓGICA: la fila sigue existiendo, con `deletedAt`.
    const despues = await db.paciente.findUnique({ where: { id: datos.a.pacienteId } });
    expect(despues, 'la baja lógica borró la fila').toBeTruthy();
    expect(despues!.deletedAt ?? null).not.toBeNull();
  });
});
