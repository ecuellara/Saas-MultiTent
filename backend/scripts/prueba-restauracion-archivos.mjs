#!/usr/bin/env node
/**
 * SIMULACRO de restauración de archivos (no checklist: ejecución real).
 *
 * Hermético: trabaja en un directorio temporal propio y NUNCA toca el
 * `uploads/` real (ni lo lee: `UPLOADS_DIR` apunta al temporal). Crea sus
 * propios ficheros de prueba bajo `tenants/zz-prueba-respaldo/...` —algunos
 * binarios y de tamaños distintos— y los borra al terminar (pase o falle).
 *
 *  1. Empaqueta con `backup-archivos.mjs` de verdad (hijo).
 *  2. Extrae con `restaurar-archivos.mjs` en un directorio limpio.
 *  3. Compara **mapa de sha256 por fichero** (no solo el conteo: un archivo
 *     truncado pasaría un conteo), además del número de ficheros, los bytes
 *     totales y los conteos por tenant del manifiesto. Falla si hay
 *     diferencias, y falla si no hay ficheros (salvo `PERMITIR_SIMULACRO_VACIO`).
 *  4. Informa el tiempo de restauración.
 *
 * Uso: npm run archivos:prueba-restauracion
 */
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  agruparPorTenant,
  caminarArbol,
  sha256Archivo,
} from './lib/respaldo.mjs';

const ACA = path.dirname(fileURLToPath(import.meta.url));

function correrScript(nombre, args, envExtra = {}) {
  try {
    return execFileSync(process.execPath, [path.join(ACA, nombre), ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...envExtra },
    });
  } catch (e) {
    if (e.stdout) process.stdout.write(String(e.stdout));
    if (e.stderr) process.stderr.write(String(e.stderr));
    throw new Error(`${nombre} falló (código ${e.status ?? '?'})`);
  }
}

/** Ficheros de prueba: dos tenants, binarios, tamaños distintos. */
async function sembrarFixtures(raiz) {
  const ficheros = {
    'tenants/zz-prueba-respaldo/patients/p1/documents/a.png': randomBytes(1536),
    'tenants/zz-prueba-respaldo/patients/p1/xrays/b.jpg': randomBytes(4096),
    'tenants/zz-prueba-respaldo/consents/c.pdf': randomBytes(256),
    'tenants/zz-prueba-respaldo/config/logo.png': randomBytes(1024),
    'tenants/zz-otro-1/patients/q/documents/d.png': randomBytes(2048),
    'tenants/zz-prueba-respaldo/patients/p1/documents/e.png': randomBytes(102400),
  };
  for (const [rel, contenido] of Object.entries(ficheros)) {
    const destino = path.join(raiz, ...rel.split('/'));
    await fs.mkdir(path.dirname(destino), { recursive: true });
    await fs.writeFile(destino, contenido);
  }
  await fs.mkdir(path.join(raiz, 'tenants', 'zz-prueba-respaldo', 'vacio'), { recursive: true });
}

async function mapaSha(raiz, ficheros) {
  const mapa = {};
  for (const f of ficheros) {
    mapa[f.rel] = await sha256Archivo(path.join(raiz, ...f.rel.split('/')));
  }
  return mapa;
}

async function main() {
  const t0 = Date.now();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'saas-archivos-'));
  const src = path.join(tmp, 'origen');
  const dest = path.join(tmp, 'restaurado');
  const backs = path.join(tmp, 'backups');
  await Promise.all([fs.mkdir(src, { recursive: true }), fs.mkdir(backs, { recursive: true })]);
  try {
    await sembrarFixtures(src);
    const { ficheros: esperados } = await caminarArbol(src);
    if (esperados.length === 0 && process.env.PERMITIR_SIMULACRO_VACIO !== '1') {
      throw new Error('Sin ficheros de prueba: el simulacro no tendría nada que comparar');
    }
    const envHijo = { UPLOADS_DIR: src, BACKUP_DIR: backs };

    const salidaBackup = correrScript('backup-archivos.mjs', [], envHijo);
    process.stdout.write(salidaBackup);
    const linea = salidaBackup.split('\n').find((l) => l.startsWith('PAQUETE='));
    if (!linea) throw new Error('backup-archivos.mjs no informó PAQUETE=: no se puede continuar');
    const paquete = linea.slice('PAQUETE='.length).trim();
    const tEmpaquetado = Date.now();

    // El manifiesto debe cuadrar con lo sembrado (conteos por tenant incluidos).
    const manifiesto = JSON.parse(
      await fs.readFile(`${paquete}.manifiesto.json`, 'utf8'),
    );
    const gruposEsperados = agruparPorTenant(esperados.map((f) => f.rel));
    for (const [tenant, n] of Object.entries(gruposEsperados)) {
      if (manifiesto.porTenant?.[tenant] !== n) {
        throw new Error(`Manifiesto incoherente en ${tenant}: dice ${manifiesto.porTenant?.[tenant]}, hay ${n}`);
      }
    }
    if (manifiesto.nFicheros !== esperados.length) {
      throw new Error(`Manifiesto incoherente: dice ${manifiesto.nFicheros}, hay ${esperados.length}`);
    }

    const t1 = Date.now();
    const salidaRestore = correrScript(
      'restaurar-archivos.mjs',
      ['--archivo', paquete, '--destino', dest, '--confirmo-restauracion'],
      envHijo,
    );
    process.stdout.write(salidaRestore);
    const tRestauracion = Date.now();

    const { ficheros: obtenidos, directorios } = await caminarArbol(dest);
    let fallos = 0;
    const falta = (m) => {
      fallos++;
      console.log(`  FAIL ${m}`);
    };
    console.log('Comparación origen vs restaurado (sha256 por fichero):');
    if (obtenidos.length !== esperados.length) {
      falta(`nFicheros: origen=${esperados.length} restaurado=${obtenidos.length}`);
    }
    const shaOrigen = await mapaSha(src, esperados);
    const shaCopia = await mapaSha(dest, obtenidos);
    for (const rel of Object.keys(shaOrigen).sort()) {
      if (!(rel in shaCopia)) {
        falta(`ausente en restaurado: ${rel}`);
      } else if (shaCopia[rel] !== shaOrigen[rel]) {
        falta(`contenido distinto: ${rel}`);
      }
    }
    for (const rel of Object.keys(shaCopia).sort()) {
      if (!(rel in shaOrigen)) falta(`sobrante en restaurado: ${rel}`);
    }
    const bytesOrigen = esperados.reduce((s, f) => s + f.bytes, 0);
    const bytesCopia = obtenidos.reduce((s, f) => s + f.bytes, 0);
    if (bytesOrigen !== bytesCopia) falta(`bytes: origen=${bytesOrigen} restaurado=${bytesCopia}`);
    if (!directorios.includes('tenants/zz-prueba-respaldo/vacio')) {
      falta('falta el directorio vacío de prueba');
    }
    const nSha = Object.keys(shaOrigen).length;
    console.log(`  sha256 comparados: ${nSha}, bytes: ${bytesOrigen}`);
    console.log(`Paquete: ${paquete.split(/[\\/]/).pop()}`);
    console.log(`Restauración medida: ${((tRestauracion - t1) / 1000).toFixed(1)} s`);
    console.log(`Total simulacro: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    if (fallos > 0) throw new Error(`SIMULACRO FALLIDO (${fallos} diferencias)`);
    console.log('SIMULACRO OK');
  } finally {
    // Limpieza siempre, falle o no. El temporal es nuestro y solo nuestro.
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(`FALLO EN EL SIMULACRO DE ARCHIVOS\n\n${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
