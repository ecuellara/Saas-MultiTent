#!/usr/bin/env node
/**
 * Copia de los respaldos a un destino EXTERNO (deuda nº 14).
 *
 * Copia los artefactos MÁS RECIENTES de `BACKUP_DIR` —el volcado de la base,
 * el paquete de archivos y sus dos manifiestos— a `RESPALDO_REMOTO`:
 *   - ruta local o disco montado (`D:\respaldos`, `/mnt/respaldos`): copia
 *     con node y verifica.
 *   - remoto `rclone` (`b2:bucket/dental-saas`): copia con `rclone copy` si el
 *     binario existe (si no, FALLA: no hay repliegue silencioso a local).
 *
 * Una copia sin verificar NO es una copia: el `sha256` del archivo remoto se
 * compara con el del manifiesto, y si no coincide (o falta), el script FALLA
 * con código != 0. Los manifiestos se comparan byte a byte.
 *
 * Sin `RESPALDO_REMOTO` el script FALLA (no avisa y sigue): un respaldo
 * "externo" que en realidad no sale de la máquina es peor que no tenerlo,
 * porque da falsa sensación de seguridad.
 *
 * Retención en el destino con `BACKUP_RETENCION_DIAS` (por defecto 14, por
 * sello del nombre, no por mtime: los listados rclone no siempre traen fecha
 * fiable). Solo se tocan nuestros 4 patrones; lo demás ni se mira.
 *
 * Nunca imprime credenciales ni la URL de la base (ni siquiera la lee: este
 * script no toca la base de datos).
 *
 * Uso:
 *   cd backend
 *   RESPALDO_REMOTO="D:\respaldos" npm run db:backup-remoto
 *   RESPALDO_REMOTO="b2:bucket/dental-saas" npm run db:backup-remoto
 *   RESPALDO_REMOTO="..." npm run db:backup-remoto -- --verificar
 * (`--verificar` solo comprueba las copias que ya hay en el destino.)
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  exigirEnv,
  ejecutar,
  esDestinoRclone,
  extraerSello,
  redactar,
  sha256Archivo,
} from './lib/respaldo.mjs';

try {
  process.loadEnvFile?.();
} catch {
  // Sin `.env`: se usan las variables del entorno tal cual.
}

/** Los 4 patrones que el script gestiona en el destino (nada más se toca). */
function esArtefactoNuestro(nombre) {
  if (nombre.endsWith('.dump')) return true;
  if (nombre.endsWith('.dump.manifiesto.json')) return true;
  if (nombre.startsWith('archivos-') && nombre.endsWith('.tar.gz')) return true;
  if (nombre.startsWith('archivos-') && nombre.endsWith('.tar.gz.manifiesto.json')) return true;
  return false;
}

/** El más reciente por SELLO del nombre (determinista; nunca por mtime). */
async function masReciente(dir, { sufijo, prefijo = '' }) {
  const entradas = await fs.readdir(dir).catch(() => null);
  if (!entradas) throw new Error(`BACKUP_DIR no es legible: ${dir}`);
  let mejor = null;
  for (const n of entradas) {
    if (!n.endsWith(sufijo) || n.endsWith('.manifiesto.json')) continue;
    if (prefijo && !n.startsWith(prefijo)) continue;
    const fecha = extraerSello(n);
    if (!fecha) continue;
    if (!mejor || fecha > mejor.fecha) mejor = { nombre: n, fecha };
  }
  return mejor;
}

function unirRemoto(destino, nombre) {
  // Los remotos rclone usan `/` siempre; en local manda path.join.
  if (esDestinoRclone(destino)) return `${destino.replace(/\/+$/, '')}/${nombre}`;
  return path.join(destino, nombre);
}

// ------------------------------------------------------------ modo rclone ---

function exigirRclone() {
  const r = spawnSync('rclone', ['version'], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(
      'El destino es un remoto rclone pero el binario `rclone` no está instalado ' +
        'o falló `rclone version`. Sin él no hay copia: instala rclone o usa una ruta local.',
    );
  }
}

function rcloneLista(destino) {
  const r = spawnSync('rclone', ['lsf', destino], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`rclone lsf falló sobre el destino: ${redactar(r.stderr || 'sin detalle')}`);
  }
  return String(r.stdout).split('\n').map((l) => l.trim()).filter(Boolean);
}

/** sha256 del archivo remoto por streaming (sin cargarlo entero en memoria). */
function hashRclone(remotoArchivo) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const hijo = spawn('rclone', ['cat', remotoArchivo], { stdio: ['ignore', 'pipe', 'pipe'] });
    let salidaError = '';
    hijo.stdout.on('data', (d) => h.update(d));
    hijo.stderr.on('data', (d) => { salidaError += String(d); });
    hijo.on('error', reject);
    hijo.on('close', (codigo) => {
      if (codigo !== 0) reject(new Error(`rclone cat falló (${codigo}): ${redactar(salidaError)}`));
      else resolve(h.digest('hex'));
    });
  });
}

// --------------------------------------------------------------- verificación

async function leerManifiesto(ruta, modo) {
  // Local: lectura directa. Rclone: descarga por `cat` (el manifiesto es
  // diminuto; aquí sí vale buffer).
  if (modo === 'rclone') {
    const r = spawnSync('rclone', ['cat', ruta], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`no se pudo leer el manifiesto remoto ${ruta.split('/').pop()}`);
    return String(r.stdout);
  }
  return fs.readFile(ruta, 'utf8').catch(() => {
    throw new Error(`falta el manifiesto: ${String(ruta).split(/[\\/]/).pop()}`);
  });
}

/**
 * Verifica UN artefacto remoto contra su manifiesto: hash del archivo +
 * igualdad byte a byte del manifiesto. Devuelve { nombre, bytes, sha256 }.
 * Falla si falta el manifiesto o si algo no coincide.
 */
async function verificarArtefacto(destino, modo, nombre, manifiestoLocalAbs) {
  const remotoArchivo = unirRemoto(destino, nombre);
  const remotoManifiesto = `${remotoArchivo}.manifiesto.json`;
  const textoManifiesto = await leerManifiesto(remotoManifiesto, modo);
  let manifiesto;
  try {
    manifiesto = JSON.parse(textoManifiesto);
  } catch {
    throw new Error(`manifiesto ilegible para ${nombre}: no se puede verificar`);
  }
  if (typeof manifiesto.sha256 !== 'string' || !manifiesto.sha256) {
    throw new Error(`el manifiesto de ${nombre} no trae sha256: no se puede verificar`);
  }
  const hash = modo === 'rclone' ? await hashRclone(remotoArchivo) : await sha256Archivo(remotoArchivo);
  if (hash !== manifiesto.sha256) {
    throw new Error(
      `VERIFICACIÓN FALLIDA en ${nombre}: el remoto no coincide con el manifiesto ` +
        `(remoto ${hash.slice(0, 12)}… vs manifiesto ${String(manifiesto.sha256).slice(0, 12)}…). ` +
        'La copia NO es válida.',
    );
  }
  if (manifiestoLocalAbs) {
    const local = await fs.readFile(manifiestoLocalAbs, 'utf8');
    if (local !== textoManifiesto) {
      throw new Error(`el manifiesto remoto de ${nombre} difiere del local: copia a medias`);
    }
  }
  return { nombre, bytes: Number(manifiesto.bytes ?? 0), sha256: manifiesto.sha256 };
}

// ---------------------------------------------------------------- retención ---

/** Borra del destino lo nuestro más antiguo que el plazo (nunca lo recién copiado). */
async function aplicarRetencionRemota(destino, modo, recienCopiados) {
  const dias = Number(process.env.BACKUP_RETENCION_DIAS ?? 14);
  if (!Number.isFinite(dias) || dias < 0) {
    throw new Error('BACKUP_RETENCION_DIAS debe ser un número >= 0');
  }
  const limite = Date.now() - dias * 86_400_000;
  const protegidos = new Set(recienCopiados);
  const nombres =
    modo === 'rclone' ? rcloneLista(destino) : await fs.readdir(destino).catch(() => []);
  // Base (dump/paquete) con sello viejo → él + su manifiesto. Manifiesto
  // huérfano con sello viejo → también fuera.
  const borrar = new Set();
  for (const n of nombres) {
    if (!esArtefactoNuestro(n) || protegidos.has(n)) continue;
    const base = n.endsWith('.manifiesto.json') ? n.slice(0, -'.manifiesto.json'.length) : n;
    const esManifiesto = base !== n;
    const fecha = extraerSello(n);
    if (!fecha || fecha.getTime() >= limite) continue;
    if (esManifiesto) {
      borrar.add(n);
    } else {
      borrar.add(n);
      borrar.add(`${n}.manifiesto.json`);
    }
  }
  const borrados = [];
  for (const n of [...borrar].sort()) {
    if (protegidos.has(n)) continue;
    if (modo === 'rclone') {
      ejecutar('rclone', ['deletefile', unirRemoto(destino, n)]);
    } else {
      await fs.unlink(path.join(destino, n)).catch(() => undefined);
    }
    borrados.push(n);
  }
  return borrados;
}

// ------------------------------------------------------------------- principal

function leerArgs() {
  const v = {};
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)(=(.*))?$/.exec(a);
    if (m) v[m[1]] = m[3] ?? '1';
  }
  return v;
}

async function copiarAlRemoto(destino, modo, origenAbs, nombre) {
  if (modo === 'rclone') {
    ejecutar('rclone', ['copy', origenAbs, destino]);
  } else {
    await fs.mkdir(destino, { recursive: true });
    await fs.copyFile(origenAbs, path.join(destino, nombre));
  }
}

async function main() {
  const args = leerArgs();
  const destino = exigirEnv('RESPALDO_REMOTO').trim();
  const modo = esDestinoRclone(destino) ? 'rclone' : 'local';

  // --verificar: solo comprueba lo que ya hay fuera, sin copiar nada.
  if ('verificar' in args) {
    if (modo === 'rclone') exigirRclone();
    const nombres =
      modo === 'rclone' ? rcloneLista(destino) : await fs.readdir(destino).catch(() => []);
    const bases = nombres.filter(
      (n) => esArtefactoNuestro(n) && !n.endsWith('.manifiesto.json') && extraerSello(n),
    );
    if (bases.length === 0) throw new Error(`sin artefactos verificables en el destino`);
    for (const n of bases.sort()) {
      const v = await verificarArtefacto(destino, modo, n, null);
      console.log(`OK ${v.nombre} (${v.bytes} bytes, sha256 ${v.sha256.slice(0, 12)}…)`);
    }
    console.log(`Destino verificado: ${destino} (${bases.length} artefactos)`);
    return;
  }

  const dir = path.resolve(process.env.BACKUP_DIR ?? './backups');
  if (modo === 'local') {
    const rd = path.resolve(destino);
    const bd = path.resolve(dir);
    const igual = process.platform === 'win32'
      ? rd.toLowerCase() === bd.toLowerCase() || rd.toLowerCase().startsWith(bd.toLowerCase() + path.sep.toLowerCase())
      : rd === bd || rd.startsWith(bd + path.sep);
    if (igual) {
      throw new Error('RESPALDO_REMOTO está dentro de BACKUP_DIR: eso no es un destino externo');
    }
    await fs.mkdir(destino, { recursive: true });
  } else {
    exigirRclone();
  }

  const volcado = await masReciente(dir, { sufijo: '.dump' });
  if (!volcado) throw new Error(`sin volcados (*.dump con sello) en ${dir}: nada que copiar`);
  const paquete = await masReciente(dir, { sufijo: '.tar.gz', prefijo: 'archivos-' });
  if (!paquete) throw new Error(`sin paquetes (archivos-*.tar.gz con sello) en ${dir}: nada que copiar`);

  const pares = [
    { nombre: volcado.nombre, etiqueta: 'Volcado' },
    { nombre: paquete.nombre, etiqueta: 'Paquete' },
  ];
  for (const p of pares) {
    const man = path.join(dir, `${p.nombre}.manifiesto.json`);
    if (!(await fs.stat(man).catch(() => null))) {
      throw new Error(`falta el manifiesto de ${p.nombre}: sin él no se puede verificar la copia`);
    }
    p.manifiesto = man;
  }

  for (const p of pares) {
    await copiarAlRemoto(destino, modo, path.join(dir, p.nombre), p.nombre);
    await copiarAlRemoto(destino, modo, p.manifiesto, `${p.nombre}.manifiesto.json`);
  }

  const verificados = [];
  for (const p of pares) {
    const v = await verificarArtefacto(destino, modo, p.nombre, p.manifiesto);
    verificados.push(v);
    console.log(`${p.etiqueta}: ${v.nombre} (${v.bytes} bytes, sha256 ${v.sha256.slice(0, 12)}…) — verificado`);
  }

  const recien = pares.flatMap((p) => [p.nombre, `${p.nombre}.manifiesto.json`]);
  const borrados = await aplicarRetencionRemota(destino, modo, recien);
  if (borrados.length > 0) console.log(`Retención en destino: borrados ${borrados.join(', ')}`);
  else console.log('Retención en destino: nada que borrar');

  console.log(`Destino externo: ${destino} (modo ${modo})`);
  console.log(`COPIA_REMOTA_VOLCADO=${unirRemoto(destino, volcado.nombre)}`);
  console.log(`COPIA_REMOTA_PAQUETE=${unirRemoto(destino, paquete.nombre)}`);
}

main().catch((e) => {
  console.error(`FALLO EN EL RESPALDO EXTERNO\n\n${redactar(e instanceof Error ? e.message : e)}\n`);
  process.exit(1);
});
