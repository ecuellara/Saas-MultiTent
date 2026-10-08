#!/usr/bin/env node
/**
 * Copia de seguridad lógica con `pg_dump --format=custom`.
 *
 * - Destino: `BACKUP_DIR` (por defecto `./backups`), nombre
 *   `<base>-AAAAMMDD-HHMMSS.dump` (solo el NOMBRE de la base, nunca la URL).
 * - Verifica el volcado con `pg_restore --list` ANTES de darlo por bueno, y
 *   exige que incluya `_prisma_migrations` (sin ella la restauración pierde el
 *   estado de migraciones).
 * - Escribe un manifiesto `<volcado>.manifiesto.json` (fecha, tamaño, sha256,
 *   base, última migración).
 * - Retención (`BACKUP_RETENCION_DIAS`, por defecto 14): borra volcados más
 *   antiguos e informa de qué borró.
 * - Sale con código != 0 si algo falla (apto para cron).
 *
 * Modos (ver `lib/respaldo.mjs`): `docker exec` por defecto
 * (`PG_DOCKER_CONTAINER`, por defecto `dental-saas-test`), o binarios locales
 * con `PG_DUMP_BIN` + `PG_RESTORE_BIN` juntos.
 *
 * Uso: npm run db:backup   (lee DATABASE_URL; en dev viene de .env)
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  ejecutar,
  exigirEnv,
  motorRespaldo,
  parseDbUrl,
  selloUtc,
  ultimaMigracion,
  poolPara,
} from './lib/respaldo.mjs';

try {
  process.loadEnvFile?.();
} catch {
  // Sin `.env`: se usan las variables del entorno tal cual.
}

function entornoPg(url) {
  const c = parseDbUrl(url);
  const env = { ...process.env };
  env.PGHOST = c.host;
  env.PGPORT = c.port;
  env.PGUSER = c.user;
  env.PGPASSWORD = c.password;
  env.PGDATABASE = c.dbname;
  try {
    const u = new URL(url);
    if (u.searchParams.get('sslmode')) env.PGSSLMODE = u.searchParams.get('sslmode');
  } catch {
    // Sin sslmode: no se fuerza nada.
  }
  return { env, c };
}

async function main() {
  const databaseUrl = exigirEnv('DATABASE_URL');
  const { env: envPg, c } = entornoPg(databaseUrl);
  const baseDatos = c.dbname;
  const motor = motorRespaldo();

  const dir = path.resolve(process.env.BACKUP_DIR ?? './backups');
  await fs.mkdir(dir, { recursive: true });
  const base = `${baseDatos}-${selloUtc()}`;
  const archivo = `${base}.dump`;
  const destinoAbs = path.join(dir, archivo);

  if (motor.modo === 'docker') {
    const staging = `/tmp/${base}-${process.pid}.dump`;
    try {
      // pg_dump DENTRO del contenedor (ahí postgres escucha en localhost:5432).
      ejecutar('docker', [
        'exec',
        '-e',
        `PGPASSWORD=${c.password}`,
        motor.container,
        motor.dump,
        '-U', c.user,
        '-h', 'localhost',
        '-p', '5432',
        '-d', c.dbname,
        '-Fc',
        '-f', staging,
      ]);
      verificarVolcado(motor, null, staging);
      ejecutar('docker', ['cp', `${motor.container}:${staging}`, destinoAbs]);
    } finally {
      spawnSync('docker', ['exec', motor.container, 'rm', '-f', staging]);
    }
  } else {
    ejecutar(motor.dump, ['-Fc', '-f', destinoAbs], { env: envPg });
    verificarVolcado(motor, envPg, destinoAbs);
  }

  const contenido = await fs.readFile(destinoAbs);
  const sha256 = createHash('sha256').update(contenido).digest('hex');
  const pool = poolPara(databaseUrl);
  let migracion;
  try {
    migracion = await ultimaMigracion(pool);
  } finally {
    await pool.end();
  }
  const manifiesto = {
    fecha: new Date().toISOString(),
    archivo,
    bytes: contenido.length,
    sha256,
    baseDatos,
    ultimaMigracion: migracion,
  };
  await fs.writeFile(`${destinoAbs}.manifiesto.json`, `${JSON.stringify(manifiesto, null, 2)}\n`);

  const borrados = await aplicarRetencion(dir, archivo);
  console.log(`Base de datos: ${baseDatos}`);
  console.log(`Volcado: ${archivo} (${contenido.length} bytes, sha256 ${sha256.slice(0, 12)}…)`);
  console.log(`Última migración: ${migracion}`);
  if (borrados.length > 0) console.log(`Retención: borrados ${borrados.join(', ')}`);
  else console.log('Retención: nada que borrar');
  console.log(`VOLCADO=${destinoAbs}`);
}

/** `pg_restore --list` debe devolver contenido e incluir `_prisma_migrations`. */
function verificarVolcado(motor, envPg, ruta) {
  let listado;
  if (motor.modo === 'docker') {
    listado = ejecutar('docker', ['exec', motor.container, motor.restore, '--list', ruta]);
  } else {
    listado = ejecutar(motor.restore, ['--list', ruta], envPg ? { env: envPg } : {});
  }
  if (!listado.trim()) {
    throw new Error('El volcado está vacío o es ilegible (pg_restore --list sin salida)');
  }
  if (!listado.includes('_prisma_migrations')) {
    throw new Error('El volcado NO incluye _prisma_migrations: no es una copia válida');
  }
}

/** Borra volcados (y su manifiesto) más antiguos que el plazo. Nunca el recién creado. */
async function aplicarRetencion(dir, recienCreado) {
  const dias = Number(process.env.BACKUP_RETENCION_DIAS ?? 14);
  if (!Number.isFinite(dias) || dias < 0) {
    throw new Error('BACKUP_RETENCION_DIAS debe ser un número >= 0');
  }
  const limite = Date.now() - dias * 86_400_000;
  const borrados = [];
  const entradas = await fs.readdir(dir);
  for (const e of entradas) {
    if (!e.endsWith('.dump') || e === recienCreado) continue;
    const ruta = path.join(dir, e);
    const st = await fs.stat(ruta).catch(() => null);
    if (!st || !st.isFile() || st.mtimeMs >= limite) continue;
    await fs.unlink(ruta);
    await fs.unlink(`${ruta}.manifiesto.json`).catch(() => undefined);
    borrados.push(e);
  }
  return borrados;
}

main().catch((e) => {
  console.error(`FALLO EN EL BACKUP\n\n${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
