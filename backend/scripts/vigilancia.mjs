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
 *
 * Uso:
 *   cd backend
 *   DATABASE_URL="..." npm run vigilancia
 *   VIGILANCIA_API_URL=http://127.0.0.1:3001 DATABASE_URL="..." npm run vigilancia
 *   VIGILANCIA_SOLO_BD=1 DATABASE_URL="..." npm run vigilancia  # solo BD (local)
 */
import { poolPara, parseDbUrl, exigirEnv } from './lib/respaldo.mjs';

const API = process.env.VIGILANCIA_API_URL ?? 'http://127.0.0.1:3000';
// `VIGILANCIA_SOLO_BD=1` omite el chequeo HTTP (útil en local o cuando la
// vigilancia corre en otra máquina que la API). En PowerShell no se puede
// dejar una variable VACÍA (`$env:X=""` la elimina), así que el flag existe
// para no depender de ese truco de shell.
const SOLO_BD = process.env.VIGILANCIA_SOLO_BD === '1';
const VENTANA_HORAS = Number(process.env.VIGILANCIA_VENTANA_HORAS ?? 24);
const MAX_FALLOS_PCT = Number(process.env.VIGILANCIA_MAX_FALLOS_PCT ?? 5);
const MAX_CRUZADOS = Number(process.env.VIGILANCIA_MAX_CRUZADOS ?? 0);

if (!Number.isFinite(VENTANA_HORAS) || VENTANA_HORAS <= 0) {
  console.error('VIGILANCIA_VENTANA_HORAS debe ser un número > 0');
  process.exit(2);
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
