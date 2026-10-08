#!/usr/bin/env node
/**
 * Restaura un paquete de archivos (`archivos-*.tar.gz`) en un directorio.
 *
 * Guarda obligatoria (extraer encima de `uploads/` en uso mezcla o pisa datos):
 *  1. `--destino` es obligatorio y NO puede ser el `UPLOADS_DIR` en uso.
 *  2. `--confirmo-restauracion` es obligatorio.
 *  3. Si el destino existe y NO está vacío, se aborta salvo
 *     `--permitir-merge` explícito. Sin `--clean` a propósito.
 *
 * Al terminar imprime número de ficheros y bytes para poder comparar.
 *
 * Uso: npm run archivos:restaurar -- --archivo <paquete> --destino <dir> --confirmo-restauracion
 * (npm pasa lo que va tras `--` al script).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { caminarArbol, ejecutar } from './lib/respaldo.mjs';

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

/** Compara dos rutas absolutas (insensible a mayúsculas en Windows). */
async function mismaRuta(a, b) {
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  if (process.platform === 'win32') return ra.toLowerCase() === rb.toLowerCase();
  try {
    const [fa, fb] = await Promise.all([fs.realpath(ra), fs.realpath(rb)]);
    return fa === fb;
  } catch {
    return ra === rb;
  }
}

async function main() {
  const args = leerArgs();
  const archivo = args.archivo;
  const destino = args.destino;
  if (!archivo) throw new Error('Falta --archivo <paquete>');
  if (!destino) throw new Error('Falta --destino <directorio>');
  if (!('confirmo-restauracion' in args)) {
    throw new Error('Falta --confirmo-restauracion: restaura solo a propósito');
  }
  const st = await fs.stat(archivo).catch(() => null);
  if (!st || !st.isFile()) throw new Error(`No existe el paquete: ${archivo}`);

  const uploadsDir = path.resolve(process.env.UPLOADS_DIR ?? './uploads');
  const destinoAbs = path.resolve(destino);
  if (await mismaRuta(destinoAbs, uploadsDir)) {
    throw new Error(`El destino (${destinoAbs}) es el UPLOADS_DIR en uso: abortado`);
  }
  const normalizar = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const dentroDe = (hijo, padre) =>
    normalizar(hijo) === normalizar(padre) ||
    normalizar(hijo).startsWith(`${normalizar(padre)}${path.sep}`);
  if (dentroDe(destinoAbs, uploadsDir) || dentroDe(uploadsDir, destinoAbs)) {
    throw new Error('El destino solapa con el UPLOADS_DIR en uso: usa un directorio aparte');
  }

  const stDest = await fs.stat(destinoAbs).catch(() => null);
  if (stDest && !stDest.isDirectory()) {
    throw new Error(`El destino existe y no es un directorio: ${destinoAbs}`);
  }
  if (stDest) {
    const { ficheros } = await caminarArbol(destinoAbs);
    if (ficheros.length > 0 && !('permitir-merge' in args)) {
      throw new Error(
        `El destino ya tiene ${ficheros.length} ficheros: ` +
          'abórtalo a mano, usa un directorio vacío o pasa --permitir-merge.',
      );
    }
  } else {
    await fs.mkdir(destinoAbs, { recursive: true });
  }

  ejecutar('tar', ['-xzf', archivo, '-C', destinoAbs]);

  const { ficheros } = await caminarArbol(destinoAbs);
  const bytes = ficheros.reduce((s, f) => s + f.bytes, 0);
  console.log(`Restaurado en ${destinoAbs} desde ${archivo.split(/[\\/]/).pop()}:`);
  console.log(`  ficheros: ${ficheros.length}, bytes: ${bytes}`);
}

main().catch((e) => {
  console.error(`FALLO EN LA RESTAURACIÓN DE ARCHIVOS\n\n${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
