#!/usr/bin/env node
/**
 * Vigilancia mínima (mejora #21, sin dependencias nuevas).
 *
 * Comprueba:
 *  1. Liveness: `GET {VIGILANCIA_API_URL}/api/health` (y su `database: ok`).
 *  2. Tasa de fallos: filas `Auditoria.resultado = FAILURE` en la ventana
 *     (`VIGILANCIA_VENTANA_HORAS`, por defecto 24). Si la tasa supera
 *     `VIGILANCIA_MAX_FALLOS_PCT` (por defecto 5), avisa.
 *  3. Acceso cruzado: filas con `datosNuevos.motivo = 'acceso_cruzado'` en la
 *     ventana. El umbral por defecto es 0: cualquier intento cuenta.
 *  4. Copia externa: antigüedad del volcado más reciente en `RESPALDO_REMOTO`.
 *     Si supera `VIGILANCIA_MAX_HORAS_REMOTO` (por defecto 48) o no hay
 *     destino configurado, falla: una copia que dejó de funcionar hace un mes
 *     no la nota nadie hasta que hace falta.
 *
 * Sale con código != 0 si algo va mal (0 OK, 1 revisar, 2 crítico): así el
 * timer/cron avisa sin parsear la salida. Nunca imprime `DATABASE_URL` ni
 * contenidos de auditoría (solo conteos, acciones y fechas).
 *
 * LÍMITES HONESTOS (leer antes de confiar ciegamente):
 *  - `Auditoria` solo registra MUTACIONES críticas (POST/PATCH/PUT/DELETE en
 *    rutas críticas): un 500 en un GET no deja fila ahí. La tasa de FAILURE
 *    es un proxy, no la tasa de 5xx completa; la señal completa vive en los
 *    logs de la API (`docker compose logs backend`, journal en systemd).
 *  - Los 403/404 "normales" (permiso denegado, recurso inexistente) NO son
 *    acceso cruzado y NO se cuentan: la señal es la marca EXPLÍCITA que pone
 *    el interceptor (`CrossTenantError`), no el código HTTP.
 *  - Los guards corren antes que el interceptor (deuda nº 1): un 401/403 de
 *    guard no deja fila de auditoría.
 *  - Punto 4 en destinos `rclone`: la antigüedad se lee del listado remoto y
 *    exige el binario instalado; sin él se informa como "revisar" (no se
 *    puede comprobar, no se da por bueno).
 *
 * Uso:
 *   cd backend
 *   DATABASE_URL="..." npm run vigilancia
 *   VIGILANCIA_API_URL=http://127.0.0.1:3001 DATABASE_URL="..." npm run vigilancia
 *   VIGILANCIA_SOLO_BD=1 DATABASE_URL="..." npm run vigilancia  # solo BD (local)
 */
import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { poolPara, parseDbUrl, exigirEnv, esDestinoRclone, extraerSello } from './lib/respaldo.mjs';

const API = process.env.VIGILANCIA_API_URL ?? 'http://127.0.0.1:3000';
// `VIGILANCIA_SOLO_BD=1` omite el chequeo HTTP (útil en local o cuando la
// vigilancia corre en otra máquina que la API). En PowerShell no se puede
// dejar una variable VACÍA (`$env:X=""` la elimina), así que el flag existe
// para no depender de ese truco de shell.
const SOLO_BD = process.env.VIGILANCIA_SOLO_BD === '1';
const VENTANA_HORAS = Number(process.env.VIGILANCIA_VENTANA_HORAS ?? 24);
const MAX_FALLOS_PCT = Number(process.env.VIGILANCIA_MAX_FALLOS_PCT ?? 5);
const MAX_CRUZADOS = Number(process.env.VIGILANCIA_MAX_CRUZADOS ?? 0);
const MAX_HORAS_REMOTO = Number(process.env.VIGILANCIA_MAX_HORAS_REMOTO ?? 48);

if (!Number.isFinite(VENTANA_HORAS) || VENTANA_HORAS <= 0) {
  console.error('VIGILANCIA_VENTANA_HORAS debe ser un número > 0');
  process.exit(2);
}
if (!Number.isFinite(MAX_HORAS_REMOTO) || MAX_HORAS_REMOTO <= 0) {
  console.error('VIGILANCIA_MAX_HORAS_REMOTO debe ser un número > 0');
  process.exit(2);
}

/** Nombres remotos (lista local o `rclone lsf`) o null si no se puede listar. */
function listarRemoto(destino) {
  if (!esDestinoRclone(destino)) {
    return fs.readdir(destino).catch(() => null);
  }
  const r = spawnSync('rclone', ['lsf', destino], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return String(r.stdout).split('\n').map((l) => l.trim()).filter(Boolean);
}

/** Antigüedad en horas del volcado más reciente del destino, o un diagnóstico. */
async function antiguedadRemoto(destino) {
  if (esDestinoRclone(destino)) {
    const v = spawnSync('rclone', ['version'], { encoding: 'utf8' });
    if (v.status !== 0) {
      return { estado: 'revisar', detalle: 'destino rclone sin binario instalado: antigüedad no comprobable' };
    }
  }
  const nombres = await listarRemoto(destino);
  if (!nombres) return { estado: 'critico', detalle: 'destino ilegible (¿ruta montada? ¿remoto accesible?)' };
  let mejor = null;
  for (const n of nombres) {
    if (!n.endsWith('.dump') || n.endsWith('.manifiesto.json')) continue;
    const fecha = extraerSello(n);
    if (!fecha) continue;
    if (!mejor || fecha > mejor.fecha) mejor = { nombre: n, fecha };
  }
  if (!mejor) return { estado: 'critico', detalle: 'sin volcados con nombre válido en el destino' };
  const horas = (Date.now() - mejor.fecha.getTime()) / 3_600_000;
  if (horas > MAX_HORAS_REMOTO) {
    return { estado: 'critico', detalle: `copia más reciente de hace ${horas.toFixed(1)}h (umbral ${MAX_HORAS_REMOTO}h): ${mejor.nombre}` };
  }
  return { estado: 'ok', detalle: `copia más reciente de hace ${horas.toFixed(1)}h: ${mejor.nombre}` };
}

async function chequearSalud() {
  if (SOLO_BD || !API) return { estado: 'omitido', detalle: 'chequeo HTTP desactivado' };
  let r;
  try {
    r = await fetch(`${API.replace(/\/$/, '')}/api/health`);
  } catch (e) {
    return { estado: 'critico', detalle: `sin respuesta (${e instanceof Error ? e.message : e})` };
  }
  if (!r.ok) return { estado: 'critico', detalle: `HTTP ${r.status}` };
  let cuerpo;
  try {
    cuerpo = await r.json();
  } catch {
    return { estado: 'critico', detalle: 'respuesta no JSON' };
  }
  if (cuerpo?.status !== 'ok') return { estado: 'critico', detalle: `status=${cuerpo?.status}` };
  if (cuerpo?.database !== 'ok') {
    return { estado: 'revisar', detalle: 'API ok pero database != ok' };
  }
  return { estado: 'ok', detalle: 'status ok, database ok' };
}

async function main() {
  const databaseUrl = exigirEnv('DATABASE_URL');
  const base = parseDbUrl(databaseUrl).dbname;
  const pool = poolPara(databaseUrl);
  let peor = 0; // 0 ok, 1 revisar, 2 crítico
  const lineas = [];
  try {
    // ---- 1. Liveness ------------------------------------------------------
    const salud = await chequearSalud();
    lineas.push(`salud(${API || 'omitida'}): ${salud.estado} — ${salud.detalle}`);
    if (salud.estado === 'critico') peor = Math.max(peor, 2);
    if (salud.estado === 'revisar') peor = Math.max(peor, 1);

    // ---- 2. Tasa de fallos en la ventana ----------------------------------
    const fallos = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE "resultado" = 'FAILURE')::int AS fallos,
              COUNT(*)::int AS total
         FROM "Auditoria"
        WHERE "createdAt" >= NOW() - ($1 || ' hours')::interval`,
      [String(VENTANA_HORAS)],
    );
    const { fallos: nFallos, total } = fallos.rows[0];
    const pct = total > 0 ? (100 * nFallos) / total : 0;
    let estadoFallos = 'ok';
    if (total > 0 && pct > MAX_FALLOS_PCT) {
      estadoFallos = 'revisar';
      peor = Math.max(peor, 1);
    }
    lineas.push(
      `auditoria(${base}, ${VENTANA_HORAS}h): ${total} mutaciones, ${nFallos} FAILURE (${pct.toFixed(1)}%, umbral ${MAX_FALLOS_PCT}%) — ${estadoFallos}`,
    );
    if (nFallos > 0) {
      const recientes = await pool.query(
        `SELECT "createdAt", "accion", "tenantId"
           FROM "Auditoria"
          WHERE "resultado" = 'FAILURE'
            AND "createdAt" >= NOW() - ($1 || ' hours')::interval
          ORDER BY "createdAt" DESC LIMIT 10`,
        [String(VENTANA_HORAS)],
      );
      for (const f of recientes.rows) {
        lineas.push(`  FAILURE ${f.createdAt.toISOString()} tenant=${f.tenantId ?? '-'} ${f.accion}`);
      }
    }

    // ---- 3. Acceso cruzado (tolerancia configurada, por defecto 0) --------
    const cruz = await pool.query(
      `SELECT COUNT(*)::int AS n FROM "Auditoria"
        WHERE "createdAt" >= NOW() - ($1 || ' hours')::interval
          AND "datosNuevos"->>'motivo' = 'acceso_cruzado'`,
      [String(VENTANA_HORAS)],
    );
    const nCruz = cruz.rows[0].n;
    let estadoCruz = 'ok';
    if (nCruz > MAX_CRUZADOS) {
      estadoCruz = 'critico';
      peor = Math.max(peor, 2);
    }
    lineas.push(`acceso_cruzado(${VENTANA_HORAS}h): ${nCruz} (umbral ${MAX_CRUZADOS}) — ${estadoCruz}`);
    if (nCruz > 0) {
      const detalle = await pool.query(
        `SELECT "createdAt", "accion", "tenantId", "usuarioId"
           FROM "Auditoria"
          WHERE "createdAt" >= NOW() - ($1 || ' hours')::interval
            AND "datosNuevos"->>'motivo' = 'acceso_cruzado'
          ORDER BY "createdAt" DESC LIMIT 10`,
        [String(VENTANA_HORAS)],
      );
      for (const f of detalle.rows) {
        lineas.push(
          `  CRUZADO ${f.createdAt.toISOString()} tenant=${f.tenantId ?? '-'} usuario=${f.usuarioId ?? '-'} ${f.accion}`,
        );
      }
    }

    // ---- 4. Antigüedad de la copia externa --------------------------------
    const remoto = (process.env.RESPALDO_REMOTO ?? '').trim();
    if (!remoto) {
      lineas.push('respaldo_remoto: critico — RESPALDO_REMOTO no configurado (sin copia externa)');
      peor = Math.max(peor, 2);
    } else {
      const ant = await antiguedadRemoto(remoto);
      lineas.push(`respaldo_remoto: ${ant.estado} — ${ant.detalle}`);
      if (ant.estado === 'critico') peor = Math.max(peor, 2);
      if (ant.estado === 'revisar') peor = Math.max(peor, 1);
    }
  } finally {
    await pool.end().catch(() => undefined);
  }

  const veredicto = peor === 0 ? 'OK' : peor === 1 ? 'REVISAR' : 'CRITICO';
  console.log(`Vigilancia [${veredicto}]`);
  for (const l of lineas) console.log(`  ${l}`);
  process.exit(peor);
}

main().catch((e) => {
  console.error(`FALLO EN LA VIGILANCIA\n\n${e instanceof Error ? e.message : e}\n`);
  process.exit(2);
});
