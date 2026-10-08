#!/usr/bin/env node
/**
 * Utilidades compartidas de los scripts de respaldo (backup / restaurar /
 * prueba-restauracion). Solo stdlib + `pg` (ya es dependencia del backend).
 *
 * REGLA DE ORO: `DATABASE_URL` lleva la contraseña y NUNCA se registra ni se
 * imprime. En logs, nombres de archivo y manifiestos solo aparece el NOMBRE
 * de la base de datos. La contraseña solo viaja por variables de entorno de
 * procesos hijos (`PGPASSWORD`), nunca en la línea de comandos.
 */
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const { Pool } = pg;

/** Tablas que el simulacro compara entre origen y restaurada. */
export const TABLAS_COMPARACION = [
  'Tenant',
  'User',
  'Paciente',
  'Cita',
  'Pago',
  'Insumo',
  'Compra',
  'Auditoria',
];

/**
 * Lee una variable obligatoria. Sin valor por defecto a propósito: un fallback
 * silencioso puede apuntar a la base de datos equivocada.
 */
export function exigirEnv(nombre) {
  const v = process.env[nombre];
  if (!v) {
    console.error(`Falta ${nombre} (sin valor por defecto: revísalo en .env)`);
    process.exit(1);
  }
  return v;
}

function quitarBarraFinal(s) {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

/**
 * Descompone una URL `postgresql://usuario:clave@host:puerto/base?...`.
 * La contraseña queda SOLO en memoria; `nombre()` expone lo publicable.
 */
export function parseDbUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    console.error('DATABASE_URL no es una URL válida');
    process.exit(1);
  }
  if (!u.username || !quitarBarraFinal(u.pathname).slice(1)) {
    console.error('DATABASE_URL debe incluir usuario y base de datos');
    process.exit(1);
  }
  return {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    host: u.hostname || 'localhost',
    port: u.port || '5432',
    dbname: decodeURIComponent(quitarBarraFinal(u.pathname).slice(1)),
  };
}

/** Sello UTC `AAAAMMDD-HHMMSS` (apto para nombres de archivo en Windows). */
export function selloUtc(fecha = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${fecha.getUTCFullYear()}${p(fecha.getUTCMonth() + 1)}${p(fecha.getUTCDate())}` +
    `-${p(fecha.getUTCHours())}${p(fecha.getUTCMinutes())}${p(fecha.getUTCSeconds())}`
  );
}

/**
 * Motor de ejecución de los binarios de Postgres.
 * - Si `PG_DUMP_BIN` y `PG_RESTORE_BIN` están definidos: modo local (CI,
 *   servidores con cliente instalado).
 * - Si no: modo `docker exec` contra `PG_DOCKER_CONTAINER`
 *   (por defecto `dental-saas-test`). Configurar solo uno de los dos es un
 *   error: se aborta en lugar de mezclar modos.
 */
export function motorRespaldo() {
  const dump = process.env.PG_DUMP_BIN;
  const restore = process.env.PG_RESTORE_BIN;
  if ((dump && !restore) || (!dump && restore)) {
    console.error('Configura PG_DUMP_BIN y PG_RESTORE_BIN juntos, o ninguno (modo docker)');
    process.exit(1);
  }
  if (dump && restore) return { modo: 'local', dump, restore, container: null };
  return {
    modo: 'docker',
    dump: 'pg_dump',
    restore: 'pg_restore',
    container: process.env.PG_DOCKER_CONTAINER ?? 'dental-saas-test',
  };
}

/**
 * Ejecuta un binario y devuelve stdout. En caso de error muestra stderr
 * REDACTADO y sale con código 1. Los argumentos que llevan secretos
 * (`PGPASSWORD=...`) se enmascaran también en la línea del comando.
 */
export function ejecutar(bin, args, opts = {}) {
  const r = spawnSync(bin, args, { encoding: 'utf8', ...opts });
  if (r.status !== 0) {
    const cmd = [bin, ...args.map(enmascarar)].join(' ');
    console.error(`Falló: ${cmd}`);
    console.error(redactar(r.stderr || r.error?.message || 'error desconocido'));
    process.exit(1);
  }
  return r.stdout ?? '';
}

function enmascarar(arg) {
  if (/^PGPASSWORD=/.test(arg)) return 'PGPASSWORD=***';
  return arg;
}

/** Quita cualquier rastro de contraseña de un texto (defensa en profundidad). */
export function redactar(texto) {
  return String(texto).replace(/:[^:@/\s]+@/g, ':***@');
}

/**
 * Pool `pg` contra la URL dada (opcionalmente cambiando la base).
 * `sslmode=require` en la URL se respeta; en local sin SSL no se fuerza nada.
 */
export function poolPara(databaseUrl, dbname) {
  let url = databaseUrl;
  if (dbname) {
    const u = new URL(databaseUrl);
    u.pathname = `/${dbname}`;
    url = u.toString();
  }
  return new Pool({ connectionString: url });
}

/** Última migración aplicada según `_prisma_migrations`. */
export async function ultimaMigracion(pool) {
  const r = await pool.query(
    `SELECT migration_name AS nombre FROM "_prisma_migrations"
     WHERE finished_at IS NOT NULL
     ORDER BY finished_at DESC, started_at DESC LIMIT 1`,
  );
  return r.rows[0]?.nombre ?? '(sin migraciones registradas)';
}

/** Recuentos de filas por tabla (todas deben existir tras una restauración). */
export async function contarFilas(pool, tablas = TABLAS_COMPARACION) {
  const conteos = {};
  for (const t of tablas) {
    const r = await pool.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
    conteos[t] = r.rows[0].n;
  }
  return conteos;
}

/** ¿Existe la base de datos? */
export async function existeBase(poolMantenimiento, dbname) {
  const r = await poolMantenimiento.query('SELECT 1 AS ok FROM pg_database WHERE datname = $1', [dbname]);
  return r.rows.length > 0;
}

/** Tablas de usuario en el esquema `public` (excluye catálogos del sistema). */
export async function tablasPublicas(pool) {
  const r = await pool.query(
    `SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`,
  );
  return r.rows.map((x) => x.t);
}

// ============================================================
// Archivos (respaldo de `uploads/`)
// ============================================================

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Recorre un árbol y devuelve rutas RELATIVAS en estilo posix, separando
 * ficheros y directorios (los tar listan los directorios con `/` final y hay
 * que excluirlos del conteo de ficheros).
 */
export async function caminarArbol(raiz) {
  const ficheros = [];
  const directorios = [];
  async function visitar(dir, rel) {
    const entradas = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entradas) {
      const relHijo = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        directorios.push(relHijo);
        await visitar(path.join(dir, e.name), relHijo);
      } else if (e.isFile()) {
        const st = await fs.stat(path.join(dir, e.name));
        ficheros.push({ rel: relHijo, bytes: st.size });
      }
      // Enlaces y especiales se ignoran: las claves de storage son regulares.
    }
  }
  await visitar(raiz, '');
  ficheros.sort((a, b) => (a.rel < b.rel ? -1 : 1));
  directorios.sort();
  return { ficheros, directorios };
}

/** sha256 hex de un archivo (por bloques: vale para radiografías grandes). */
export async function sha256Archivo(ruta) {
  const { createReadStream } = await import('node:fs');
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const s = createReadStream(ruta);
    s.on('error', reject);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
  });
}

/**
 * Agrupa rutas `tenants/<tenantId>/...` por tenant para el manifiesto.
 * Lo que no cuelga de `tenants/` va a `_externo` (visible, sin nombres).
 */
export function agruparPorTenant(rels) {
  const grupos = {};
  for (const rel of rels) {
    const partes = rel.split('/');
    const clave = partes.length >= 3 && partes[0] === 'tenants' ? partes[1] : '_externo';
    grupos[clave] = (grupos[clave] ?? 0) + 1;
  }
  return grupos;
}

/**
 * Retención: borra los archivos con la extensión indicada más antiguos que el
 * plazo, junto a su manifiesto `<archivo>.manifiesto.json`, sin tocar nunca
 * el recién creado. Informa de lo borrado.
 */
export async function aplicarRetencion(dir, recienCreado, extension) {
  const dias = Number(process.env.BACKUP_RETENCION_DIAS ?? 14);
  if (!Number.isFinite(dias) || dias < 0) {
    throw new Error('BACKUP_RETENCION_DIAS debe ser un número >= 0');
  }
  const limite = Date.now() - dias * 86_400_000;
  const borrados = [];
  const entradas = await fs.readdir(dir);
  for (const e of entradas) {
    if (!e.endsWith(extension) || e === recienCreado) continue;
    const ruta = path.join(dir, e);
    const st = await fs.stat(ruta).catch(() => null);
    if (!st || !st.isFile() || st.mtimeMs >= limite) continue;
    await fs.unlink(ruta);
    await fs.unlink(`${ruta}.manifiesto.json`).catch(() => undefined);
    borrados.push(e);
  }
  return borrados;
}
