#!/usr/bin/env node
/**
 * SIMULACRO del respaldo externo (no checklist: ejecución real de la CADENA).
 *
 * Prueba que la copia externa es AUTOSUFICIENTE, no que el archivo llegó:
 *  1. Vuelca la base (`backup.mjs`) y empaqueta archivos (`backup-archivos.mjs`).
 *  2. Copia al destino externo (`backup-remoto.mjs`, destino = temporal propio).
 *  3. Corrompe la copia remota y comprueba que la verificación la DETECTA
 *     (si `backup-remoto` tragara, el simulacro falla); luego la repara.
 *  4. Borra `BACKUP_DIR` (pérdida del host simulada) y restaura la base DESDE
 *     LA COPIA EXTERNA en una base de usar y tirar, comparando recuentos como
 *     `prueba-restauracion.mjs`.
 *  5. Extrae el paquete DESDE LA COPIA EXTERNA y compara el mapa de sha256
 *     por fichero.
 *  6. Limpia (base temporal y temporales) pase o falle.
 *
 * Corre sin nada externo (destino = directorio temporal) y en CI. Sin
 * `RESPALDO_REMOTO` en el entorno no pasa nada: el simulacro pone el suyo.
 * Lo que SÍ necesita (heredado del entorno): `DATABASE_URL` y el modo pg
 * (`PG_DOCKER_CONTAINER` o `PG_DUMP_BIN`+`PG_RESTORE_BIN`).
 *
 * Uso: npm run db:prueba-respaldo-remoto
 */
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TABLAS_COMPARACION,
  contarFilas,
  exigirEnv,
  existeBase,
  parseDbUrl,
  poolPara,
  selloUtc,
  ultimaMigracion,
} from './lib/respaldo.mjs';
import { agruparPorTenant, caminarArbol, sha256Archivo } from './lib/respaldo.mjs';

try {
  process.loadEnvFile?.();
} catch {
  // Sin `.env`: se usan las variables del entorno tal cual.
}

const ACA = path.dirname(fileURLToPath(import.meta.url));

function correrHijo(nombre, args, envExtra = {}) {
  try {
    const salida = execFileSync(process.execPath, [path.join(ACA, nombre), ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...envExtra },
    });
    return { ok: true, salida };
  } catch (e) {
    if (e.stdout) process.stdout.write(String(e.stdout));
    if (e.stderr) process.stderr.write(String(e.stderr));
    return { ok: false, salida: '' };
  }
}

function exigirHijo(nombre, args, envExtra = {}) {
  const r = correrHijo(nombre, args, envExtra);
  if (!r.ok) throw new Error(`${nombre} falló (ver salida de arriba)`);
  return r.salida;
}

/** Ficheros de prueba propios (no tocan `uploads/` reales). */
async function sembrarFixtures(raiz) {
  const ficheros = {
    'tenants/zz-remoto/patients/p1/documents/a.png': randomBytes(1536),
    'tenants/zz-remoto/patients/p1/xrays/b.jpg': randomBytes(4096),
    'tenants/zz-remoto/consents/c.pdf': randomBytes(256),
    'tenants/zz-otro-remoto/patients/q/documents/d.png': randomBytes(2048),
  };
  for (const [rel, contenido] of Object.entries(ficheros)) {
    const destino = path.join(raiz, ...rel.split('/'));
    await fs.mkdir(path.dirname(destino), { recursive: true });
    await fs.writeFile(destino, contenido);
  }
}

async function mapaSha(raiz, ficheros) {
  const mapa = {};
  for (const f of ficheros) {
    mapa[f.rel] = await sha256Archivo(path.join(raiz, ...f.rel.split('/')));
  }
  return mapa;
}

async function main() {
  const databaseUrl = exigirEnv('DATABASE_URL');
  const actual = parseDbUrl(databaseUrl);
  const t0 = Date.now();

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'saas-remoto-'));
  const backs = path.join(tmp, 'backups');
  const remoto = path.join(tmp, 'remoto');
  const src = path.join(tmp, 'origen');
  const restauradoArchivos = path.join(tmp, 'restaurado');
  await Promise.all([fs.mkdir(backs, { recursive: true }), fs.mkdir(src, { recursive: true })]);

  const scratch = `remoto_${selloUtc().replace('-', '_').toLowerCase()}_${process.pid}`;
  const mant = poolPara(databaseUrl);
  try {
    // 0. Sin RESPALDO_REMOTO, backup-remoto debe FALLAR (no copiar en silencio
    // a ningún sitio). Se borra del entorno del hijo a propósito.
    console.log('0. Sin RESPALDO_REMOTO debe fallar…');
    const envSinRemoto = { BACKUP_DIR: backs };
    for (const k of Object.keys(process.env)) {
      if (k !== 'RESPALDO_REMOTO') envSinRemoto[k] = process.env[k];
    }
    // OJO: el hijo también lee `.env` (loadEnvFile); si tu `.env` definiera
    // RESPALDO_REMOTO, esta prueba no podría exigirse. No lo hace.
    const negativo = correrHijo('backup-remoto.mjs', [], envSinRemoto);
    if (negativo.ok) throw new Error('backup-remoto.mjs funcionó SIN RESPALDO_REMOTO: debe fallar');
    console.log('   OK: falló como debe (sin destino no hay copia silenciosa)');

    const envHijo = { BACKUP_DIR: backs, RESPALDO_REMOTO: remoto, UPLOADS_DIR: src };

    // 1. Volcado real de la base.
    console.log(`1. Origen: ${actual.dbname}`);
    const salidaBackup = exigirHijo('backup.mjs', [], envHijo);
    process.stdout.write(salidaBackup);
    const lineaVolcado = salidaBackup.split('\n').find((l) => l.startsWith('VOLCADO='));
    if (!lineaVolcado) throw new Error('backup.mjs no informó VOLCADO=');
    const volcadoNombre = lineaVolcado.slice('VOLCADO='.length).trim().split(/[\\/]/).pop();

    // 2. Paquete real de archivos (fixtures propios).
    await sembrarFixtures(src);
    const { ficheros: esperados } = await caminarArbol(src);
    const salidaPaquete = exigirHijo('backup-archivos.mjs', [], envHijo);
    process.stdout.write(salidaPaquete);
    const lineaPaquete = salidaPaquete.split('\n').find((l) => l.startsWith('PAQUETE='));
    if (!lineaPaquete) throw new Error('backup-archivos.mjs no informó PAQUETE=');
    const paqueteNombre = lineaPaquete.slice('PAQUETE='.length).trim().split(/[\\/]/).pop();

    // 3. Copia al destino externo.
    console.log('3. Copia al destino externo…');
    const salidaRemoto = exigirHijo('backup-remoto.mjs', [], envHijo);
    process.stdout.write(salidaRemoto);

    // 4. La verificación debe DETECTAR una copia corrupta (no basta existir).
    // OJO: el modo copia re-copiaría encima (reparando), así que la detección
    // se prueba con `--verificar`; después se re-copia para seguir con una
    // copia sana.
    console.log('4. Corrompo la copia remota: la verificación debe detectarlo…');
    await fs.appendFile(path.join(remoto, volcadoNombre), Buffer.from([0]));
    const corrupto = correrHijo('backup-remoto.mjs', ['--verificar'], envHijo);
    if (corrupto.ok) {
      throw new Error('la verificación aceptó una copia CORRUPTA: existir no es verificar');
    }
    console.log('   OK: la copia corrupta se rechazó');
    console.log('   Reparo re-copiando…');
    exigirHijo('backup-remoto.mjs', [], envHijo);

    // 5. Se pierde el host: BACKUP_DIR desaparece. Desde aquí, TODO sale del
    // destino externo o el simulacro falla.
    console.log('5. Elimino BACKUP_DIR: solo queda la copia externa…');
    await fs.rm(backs, { recursive: true, force: true });
    const manVolcado = JSON.parse(
      await fs.readFile(path.join(remoto, `${volcadoNombre}.manifiesto.json`), 'utf8'),
    );
    const manPaquete = JSON.parse(
      await fs.readFile(path.join(remoto, `${paqueteNombre}.manifiesto.json`), 'utf8'),
    );
    console.log(`   sha256 volcado remoto:  ${manVolcado.sha256}`);
    console.log(`   sha256 paquete remoto:  ${manPaquete.sha256}`);

    // 6. Restaurar la base DESDE LA COPIA EXTERNA y comparar.
    if (await existeBase(mant, scratch)) {
      console.log(`   La base ${scratch} ya existía (corrida anterior): se elimina`);
      await mant.query(`DROP DATABASE "${scratch}"`);
    }
    const salidaRestore = exigirHijo('restaurar.mjs', [
      '--archivo', path.join(remoto, volcadoNombre),
      '--destino', scratch,
      '--confirmo-restauracion',
    ]);
    process.stdout.write(salidaRestore);
    const origen = poolPara(databaseUrl);
    const copia = poolPara(databaseUrl, scratch);
    let fallos = 0;
    try {
      const [a, b] = await Promise.all([contarFilas(origen), contarFilas(copia)]);
      console.log('6. Comparación origen vs restaurada-desde-remoto:');
      for (const t of TABLAS_COMPARACION) {
        const ok = a[t] === b[t];
        if (!ok) fallos++;
        console.log(`     ${ok ? 'OK  ' : 'FAIL'} ${t}: origen=${a[t]} restaurada=${b[t]}`);
      }
      const [mA, mB] = await Promise.all([ultimaMigracion(origen), ultimaMigracion(copia)]);
      const okMig = mA === mB;
      if (!okMig) fallos++;
      console.log(`     ${okMig ? 'OK  ' : 'FAIL'} ultimaMigracion: ${mA} vs ${mB}`);
      const totalFilas = Object.values(a).reduce((s, n) => s + n, 0);
      if (totalFilas === 0) {
        if (process.env.PERMITIR_SIMULACRO_VACIO === '1') {
          console.log('     ADVERTENCIA: base vacía y PERMITIR_SIMULACRO_VACIO=1 (solo mecánica).');
        } else {
          fallos++;
          console.log('     FAIL la base origen está VACÍA: la comparación no prueba nada.');
        }
      }
    } finally {
      await origen.end();
      await copia.end();
    }

    // 7. Extraer el paquete DESDE LA COPIA EXTERNA y comparar sha256.
    const salidaRestoreArch = exigirHijo(
      'restaurar-archivos.mjs',
      ['--archivo', path.join(remoto, paqueteNombre), '--destino', restauradoArchivos, '--confirmo-restauracion'],
      envHijo,
    );
    process.stdout.write(salidaRestoreArch);
    const { ficheros: obtenidos } = await caminarArbol(restauradoArchivos);
    console.log('7. Comparación archivos origen vs extraído-desde-remoto (sha256):');
    if (obtenidos.length !== esperados.length) {
      fallos++;
      console.log(`     FAIL nFicheros: origen=${esperados.length} restaurado=${obtenidos.length}`);
    }
    const shaOrigen = await mapaSha(src, esperados);
    const shaCopia = await mapaSha(restauradoArchivos, obtenidos);
    for (const rel of Object.keys(shaOrigen).sort()) {
      if (!(rel in shaCopia)) {
        fallos++;
        console.log(`     FAIL ausente en restaurado: ${rel}`);
      } else if (shaCopia[rel] !== shaOrigen[rel]) {
        fallos++;
        console.log(`     FAIL contenido distinto: ${rel}`);
      }
    }
    for (const rel of Object.keys(shaCopia).sort()) {
      if (!(rel in shaOrigen)) {
        fallos++;
        console.log(`     FAIL sobrante en restaurado: ${rel}`);
      }
    }
    const grupos = agruparPorTenant(esperados.map((f) => f.rel));
    for (const [tenant, n] of Object.entries(grupos)) {
      if (manPaquete.porTenant?.[tenant] !== n) {
        fallos++;
        console.log(`     FAIL porTenant del manifiesto en ${tenant}: dice ${manPaquete.porTenant?.[tenant]}, hay ${n}`);
      }
    }
    console.log(`     sha256 comparados: ${Object.keys(shaOrigen).length}`);

    console.log(`Total simulacro: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    if (fallos > 0) throw new Error(`SIMULACRO FALLIDO (${fallos} diferencias)`);
    console.log('SIMULACRO REMOTO OK');
  } finally {
    await mant.query(`DROP DATABASE IF EXISTS "${scratch}"`).catch(() => undefined);
    await mant.end();
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(`FALLO EN EL SIMULACRO REMOTO\n\n${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
