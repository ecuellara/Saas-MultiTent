#!/usr/bin/env node
/**
 * Restaura un volcado (`pg_dump --format=custom`) en una base de destino.
 *
 * Guarda obligatoria (la restauración encima del origen pierde los datos):
 *  1. `--destino` es obligatorio y NO puede ser la misma base que
 *     `DATABASE_URL` (mismo patrón que `migrar-clinica.ts`).
 *  2. `--confirmo-restauracion` es obligatorio.
 *  3. Sin `--clean`: si el destino existe y NO está vacío (tiene tablas),
 *     se aborta. El destino normal es una base recién creada o inexistente
 *     (se crea automáticamente).
 *
 * Al terminar imprime recuentos de filas para poder comparar.
 *
 * Uso: npm run db:restaurar -- --archivo <volcado> --destino <bd> --confirmo-restauracion
 * (npm pasa lo que va tras `--` al script).
 */
import { spawnSync } from 'node:child_process';
import {
  contarFilas,
  ejecutar,
  exigirEnv,
  existeBase,
  motorRespaldo,
  parseDbUrl,
  tablasPublicas,
  ultimaMigracion,
  poolPara,
} from './lib/respaldo.mjs';

try {
  process.loadEnvFile?.();
} catch {
  // Sin `.env`: se usan las variables del entorno tal cual.
}

function leerArgs() {
  const v = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([^=]+)(=(.*))?$/.exec(argv[i]);
    if (!m) continue;
    const clave = m[1];
    if (m[3] !== undefined) v[clave] = m[3];
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) v[clave] = argv[++i];
    else v[clave] = '1';
  }
  return v;
}

async function main() {
  const args = leerArgs();
  const archivo = args.archivo;
  const destino = args.destino;
  if (!archivo) throw new Error('Falta --archivo <volcado>');
  if (!destino) throw new Error('Falta --destino <base de datos>');
  if (!('confirmo-restauracion' in args)) {
    throw new Error('Falta --confirmo-restauracion: restaura solo a propósito');
  }
  const { default: fs } = await import('node:fs/promises');
  const st = await fs.stat(archivo).catch(() => null);
  if (!st || !st.isFile()) throw new Error(`No existe el volcado: ${archivo}`);

  const databaseUrl = exigirEnv('DATABASE_URL');
  const actual = parseDbUrl(databaseUrl);
  if (destino.toLowerCase() === actual.dbname.toLowerCase()) {
    throw new Error(`El destino (${destino}) es la base de ${'DATABASE_URL'}: abortado`);
  }
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(destino)) {
    throw new Error(`Nombre de base destino inválido: ${destino}`);
  }
  const motor = motorRespaldo();

  // Conexión de mantenimiento contra la base actual (para crear/comprobar).
  const mant = poolPara(databaseUrl);
  try {
    if (!(await existeBase(mant, destino))) {
      console.log(`La base ${destino} no existe: se crea vacía`);
      await mant.query(`CREATE DATABASE "${destino.replace(/"/g, '')}"`);
    } else {
      const tablas = await tablasPublicas(poolPara(databaseUrl, destino));
      if (tablas.length > 0) {
        throw new Error(
          `El destino ${destino} NO está vacío (tablas: ${tablas.slice(0, 5).join(', ')}...): ` +
            'abórtalo a mano o usa una base nueva. Sin --clean a propósito.',
        );
      }
    }
  } finally {
    await mant.end();
  }

  if (motor.modo === 'docker') {
    const staging = `/tmp/restaurar-${process.pid}.dump`;
    try {
      ejecutar('docker', ['cp', archivo, `${motor.container}:${staging}`]);
      ejecutar('docker', [
        'exec',
        '-e',
        `PGPASSWORD=${actual.password}`,
        motor.container,
        motor.restore,
        '-U', actual.user,
        '-h', 'localhost',
        '-p', '5432',
        '-d', destino,
        staging,
      ]);
    } finally {
      spawnSync('docker', ['exec', motor.container, 'rm', '-f', staging]);
    }
  } else {
    const env = {
      ...process.env,
      PGHOST: actual.host,
      PGPORT: actual.port,
      PGUSER: actual.user,
      PGPASSWORD: actual.password,
    };
    ejecutar(motor.restore, ['-d', destino, archivo], { env });
  }

  const pool = poolPara(databaseUrl, destino);
  try {
    const conteos = await contarFilas(pool);
    console.log(`Restaurado en ${destino} desde ${archivo.split(/[\\/]/).pop()}:`);
    for (const [t, n] of Object.entries(conteos)) console.log(`  ${t}: ${n}`);
    console.log(`Última migración: ${await ultimaMigracion(pool)}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(`FALLO EN LA RESTAURACIÓN\n\n${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
