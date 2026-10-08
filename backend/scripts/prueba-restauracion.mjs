#!/usr/bin/env node
/**
 * SIMULACRO de restauración (no checklist: ejecución real).
 *
 *  1. Vuelca la base de `DATABASE_URL` ejecutando `backup.mjs` de verdad.
 *  2. La restaura en una base DE USAR Y TIRAR ejecutando `restaurar.mjs`.
 *  3. **Compara recuentos de filas** entre origen y restaurada
 *     (Tenant, User, Paciente, Cita, Pago, Insumo, Compra, Auditoria) más la
 *     última migración aplicada. Si algo no coincide, FALLA (código 1).
 *  4. Elimina la base de pruebas, falle o no (finally).
 *
 * Un simulacro que no puede fallar no vale nada: aquí hay E/S real
 * (pg_dump → pg_restore → SELECT) en cada paso.
 *
 * Uso: npm run db:prueba-restauracion   (lee DATABASE_URL; en dev viene de .env)
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
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

try {
  process.loadEnvFile?.();
} catch {
  // Sin `.env`: se usan las variables del entorno tal cual.
}

const ACA = path.dirname(fileURLToPath(import.meta.url));

function correrScript(nombre, args) {
  const script = path.join(ACA, nombre);
  try {
    return execFileSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    // El hijo ya imprimió su diagnóstico: se reenvía íntegro (si no, el
    // motivo real del fallo quedaría oculto tras un mensaje genérico).
    if (e.stdout) process.stdout.write(String(e.stdout));
    if (e.stderr) process.stderr.write(String(e.stderr));
    throw new Error(`${nombre} falló (código ${e.status ?? '?'})`);
  }
}

async function main() {
  const databaseUrl = exigirEnv('DATABASE_URL');
  const actual = parseDbUrl(databaseUrl);
  const t0 = Date.now();

  // 1. Volcado real (hijo: así se prueba también backup.mjs de punta a punta).
  console.log(`Origen: ${actual.dbname}`);
  const salidaBackup = correrScript('backup.mjs', []);
  process.stdout.write(salidaBackup);
  const linea = salidaBackup.split('\n').find((l) => l.startsWith('VOLCADO='));
  if (!linea) throw new Error('backup.mjs no informó VOLCADO=: no se puede continuar');
  const volcado = linea.slice('VOLCADO='.length).trim();
  const tVolcado = Date.now();

  // 2. Base de usar y tirar (solo nombres con nuestro prefijo + pid, para no
  // chocar entre corridas concurrentes ni tocar nunca otra base).
  const scratch = `restauracion_${selloUtc().replace('-', '_').toLowerCase()}_${process.pid}`;
  const mant = poolPara(databaseUrl);
  try {
    if (await existeBase(mant, scratch)) {
      // Resto de una corrida interrumpida: es nuestra (prefijo propio), se
      // elimina para partir de cero. Cualquier otro nombre abortaría.
      console.log(`La base ${scratch} ya existía (corrida anterior): se elimina`);
      await mant.query(`DROP DATABASE "${scratch}"`);
    }
    const salidaRestore = correrScript('restaurar.mjs', [
      '--archivo', volcado,
      '--destino', scratch,
      '--confirmo-restauracion',
    ]);
    process.stdout.write(salidaRestore);
    const tRestauracion = Date.now();

    // 3. Comparación REAL de datos (no comprobar que el archivo existe).
    const origen = poolPara(databaseUrl);
    const copia = poolPara(databaseUrl, scratch);
    let fallos = 0;
    try {
      const [a, b] = await Promise.all([contarFilas(origen), contarFilas(copia)]);
      console.log('Comparación origen vs restaurada:');
      for (const t of TABLAS_COMPARACION) {
        const ok = a[t] === b[t];
        if (!ok) fallos++;
        console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${t}: origen=${a[t]} restaurada=${b[t]}`);
      }
      const [mA, mB] = await Promise.all([ultimaMigracion(origen), ultimaMigracion(copia)]);
      const okMig = mA === mB;
      if (!okMig) fallos++;
      console.log(`  ${okMig ? 'OK  ' : 'FAIL'} ultimaMigracion: ${mA} vs ${mB}`);
      const totalFilas = Object.values(a).reduce((s, n) => s + n, 0);
      if (totalFilas === 0) {
        // La mecánica quedó verificada (dump → restore → compare), pero con la
        // base vacía la comparación no muerde: se avisa en voz alta.
        console.log('  ADVERTENCIA: la base origen está vacía; el simulacro verificó');
        console.log('  la mecánica, no contenido. Para morder hacen falta filas.');
      }
    } finally {
      await origen.end();
      await copia.end();
    }

    console.log(`Volcado: ${volcado.split(/[\\/]/).pop()}`);
    console.log(`Restauración medida: ${((tRestauracion - tVolcado) / 1000).toFixed(1)} s`);
    console.log(`Total simulacro: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    if (fallos > 0) throw new Error(`SIMULACRO FALLIDO (${fallos} diferencias)`);
    console.log('SIMULACRO OK');
  } finally {
    // 4. Limpieza siempre, falle o no.
    await mant.query(`DROP DATABASE IF EXISTS "${scratch}"`).catch(() => undefined);
    await mant.end();
  }
}

main().catch((e) => {
  console.error(`FALLO EN EL SIMULACRO\n\n${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
