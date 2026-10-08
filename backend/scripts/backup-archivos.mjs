#!/usr/bin/env node
/**
 * Respaldo de los archivos subidos (`UPLOADS_DIR`, por defecto `./uploads`).
 *
 * - Empaqueta TODO el árbol en UN `archivos-AAAAMMDD-HHMMSS.tar.gz` en
 *   `BACKUP_DIR`, conservando EXACTAMENTE las rutas relativas
 *   (`tenants/{tenantId}/...`: lo mismo que espera la aplicación y la
 *   migración de la clínica).
 * - Verifica el paquete ANTES de darlo por bueno: `tar -tzf` debe listar
 *   contenido y el conjunto de ficheros debe COINCIDIR con lo empaquetado
 *   (normalizando el prefijo `./` y excluyendo las entradas de directorio).
 * - Manifiesto `<paquete>.manifiesto.json`: fecha, archivo, bytes, sha256,
 *   número de ficheros, bytes sumados y número de ficheros por tenant. SIN
 *   nombres de archivo ni rutas con datos de pacientes: un manifiesto no es
 *   sitio para datos personales.
 * - Si no hay ningún archivo, FALLA (salvo `PERMITIR_SIMULACRO_VACIO=1`): un
 *   respaldo en verde que no copia nada da falsa confianza.
 * - Retención con `BACKUP_RETENCION_DIAS` (igual que la base) e informe.
 * - Sale con código != 0 si algo falla (apto para cron).
 *
 * `tar` es local en todos los casos (los ficheros están en este disco):
 * existe en Windows 10+ (`bsdtar`) y en los runners de CI (GNU tar).
 *
 * Uso: npm run archivos:backup   (UPLOADS_DIR/BACKUP_DIR configurables)
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  agruparPorTenant,
  aplicarRetencion,
  caminarArbol,
  ejecutar,
  selloUtc,
} from './lib/respaldo.mjs';

try {
  process.loadEnvFile?.();
} catch {
  // Sin `.env`: se usan las variables del entorno tal cual.
}

async function main() {
  const uploadsDir = path.resolve(process.env.UPLOADS_DIR ?? './uploads');
  const st = await fs.stat(uploadsDir).catch(() => null);
  if (!st || !st.isDirectory()) {
    throw new Error(`UPLOADS_DIR no es un directorio: ${uploadsDir}`);
  }
  const dir = path.resolve(process.env.BACKUP_DIR ?? './backups');
  await fs.mkdir(dir, { recursive: true });

  const { ficheros } = await caminarArbol(uploadsDir);
  if (ficheros.length === 0 && process.env.PERMITIR_SIMULACRO_VACIO !== '1') {
    throw new Error(
      `Sin ficheros en ${uploadsDir}: nada que respaldar ` +
        '(solo PERMITIR_SIMULACRO_VACIO=1 lo permite)',
    );
  }

  const base = `archivos-${selloUtc()}`;
  const archivo = `${base}.tar.gz`;
  const destinoAbs = path.join(dir, archivo);
  // `tar -czf DEST -C ORIGEN .` guarda entradas `./rel`; se normalizan al verificar.
  ejecutar('tar', ['-czf', destinoAbs, '-C', uploadsDir, '.']);

  // Verificación: el listado debe contener EXACTAMENTE los ficheros empaquetados.
  const listado = ejecutar('tar', ['-tzf', destinoAbs]);
  const enPaquete = new Set(
    listado
      .split('\n')
      .map((l) => l.trim().replace(/^\.\//, ''))
      .filter((l) => l !== '' && l !== '.' && !l.endsWith('/')),
  );
  const empaquetados = new Set(ficheros.map((f) => f.rel));
  const faltan = [...empaquetados].filter((r) => !enPaquete.has(r));
  const sobran = [...enPaquete].filter((r) => !empaquetados.has(r));
  if (faltan.length > 0 || sobran.length > 0 || enPaquete.size === 0) {
    await fs.unlink(destinoAbs).catch(() => undefined);
    throw new Error(
      `El paquete no cuadra con el origen (faltan ${faltan.length}, sobran ${sobran.length}): ` +
        'paquete defectuoso eliminado',
    );
  }

  const contenido = await fs.readFile(destinoAbs);
  const porTenant = agruparPorTenant(ficheros.map((f) => f.rel));
  const manifiesto = {
    fecha: new Date().toISOString(),
    archivo,
    bytes: contenido.length,
    sha256: createHash('sha256').update(contenido).digest('hex'),
    nFicheros: ficheros.length,
    bytesSumados: ficheros.reduce((s, f) => s + f.bytes, 0),
    porTenant,
  };
  await fs.writeFile(`${destinoAbs}.manifiesto.json`, `${JSON.stringify(manifiesto, null, 2)}\n`);

  const borrados = await aplicarRetencion(dir, archivo, '.tar.gz');
  console.log(`Origen: ${uploadsDir}`);
  console.log(`Paquete: ${archivo} (${contenido.length} bytes, ${ficheros.length} ficheros)`);
  console.log(
    `Por tenant: ${Object.entries(porTenant)
      .map(([t, n]) => `${t}=${n}`)
      .join(', ')}`,
  );
  if (borrados.length > 0) console.log(`Retención: borrados ${borrados.join(', ')}`);
  else console.log('Retención: nada que borrar');
  console.log(`PAQUETE=${destinoAbs}`);
}

main().catch((e) => {
  console.error(`FALLO EN EL BACKUP DE ARCHIVOS\n\n${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
