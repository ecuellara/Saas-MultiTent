#!/usr/bin/env node
/**
 * Comprobación de ARRANQUE real (a nivel de proceso, no un spec).
 *
 * POR QUÉ EXISTE: `tsx` transpila con esbuild, que **no emite** los metadatos de
 * decorador (`design:paramtypes`) que NestJS necesita para la inyección de
 * dependencias. El servidor arrancaba, registraba todas las rutas y decía «Nest
 * application successfully started»… y **toda ruta autenticada devolvía 500**
 * (`this.reflector` era `undefined` en `JwtAuthGuard`).
 *
 * Las 156 pruebas no lo veían, y no podían: Vitest transforma con Oxc, que sí
 * emite esos metadatos, y ninguna pasa por `dist/main.js`. Por eso esta
 * comprobación compila, ejecuta el BINARIO de verdad y hace un login. Es lo único
 * que cubre esa clase de fallo.
 *
 * Uso:  npm run smoke:arranque        (compila y comprueba)
 *
 * Requiere una base migrada y la clínica de demostración (`npm run db:seed-demo`)
 * con sus credenciales en el entorno (o en `.env`).
 */
import { spawn } from 'node:child_process';
import { setTimeout as dormir } from 'node:timers/promises';

try {
  process.loadEnvFile?.();
} catch {
  // Sin `.env`: se usan las variables del entorno tal cual.
}

const PUERTO = Number(process.env.SMOKE_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PUERTO}/api`;
const correo = process.env.DEMO_OWNER_EMAIL;
const clave = process.env.DEMO_OWNER_PASSWORD;

/** Un puerto propio para no chocar con un servidor de desarrollo en marcha. */
function exigirEntorno() {
  const faltan = [];
  if (!process.env.DATABASE_URL) faltan.push('DATABASE_URL');
  if (!process.env.JWT_SECRET) faltan.push('JWT_SECRET');
  if (!correo) faltan.push('DEMO_OWNER_EMAIL');
  if (!clave) faltan.push('DEMO_OWNER_PASSWORD');
  if (faltan.length > 0) {
    throw new Error(
      `Faltan variables de entorno: ${faltan.join(', ')}.\n` +
        '  JWT_SECRET es obligatorio aquí (a diferencia del arranque en desarrollo,\n' +
        '  que genera uno aleatorio): la comprobación hace un login real.\n' +
        '  Y la clínica de demostración debe existir: npm run db:seed-demo',
    );
  }
}

async function pedir(ruta, opciones) {
  const r = await fetch(`${BASE}${ruta}`, opciones);
  const texto = await r.text();
  let cuerpo;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    cuerpo = texto;
  }
  return { status: r.status, cuerpo };
}

function resumen(cuerpo) {
  const t = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
  return t.length > 300 ? `${t.slice(0, 300)}…` : t;
}

/**
 * Un 500 en una ruta autenticada es la firma exacta del fallo de metadatos: se
 * comprueba explícitamente para que el mensaje diga qué mirar.
 */
function diagnosticar500(status, cuerpo, donde) {
  if (status !== 500) return;
  throw new Error(
    `${donde} devolvió 500: ${resumen(cuerpo)}\n` +
      '  Si el servidor se arrancó con `tsx` (o cualquier transpilador que no emita\n' +
      '  metadatos de decorador) en lugar del `dist/` compilado con `tsc`, ESTE es el\n' +
      '  fallo: los guards reciben sus dependencias como `undefined`.',
  );
}

async function main() {
  exigirEntorno();

  const hijo = spawn(process.execPath, ['dist/main.js'], {
    env: { ...process.env, PORT: String(PUERTO) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let salida = '';
  hijo.stdout.on('data', (d) => {
    salida += String(d);
  });
  hijo.stderr.on('data', (d) => {
    salida += String(d);
  });

  try {
    // ---- 1. El proceso arranca y escucha -----------------------------------
    const limite = Date.now() + 45_000;
    let escucha = false;
    while (Date.now() < limite) {
      if (hijo.exitCode !== null) {
        throw new Error(`El proceso terminó con código ${hijo.exitCode} sin llegar a escuchar:\n${salida}`);
      }
      try {
        const r = await fetch(`${BASE}/health`);
        if (r.ok) {
          escucha = true;
          break;
        }
      } catch {
        // Todavía no escucha: se reintenta.
      }
      await dormir(400);
    }
    if (!escucha) {
      throw new Error(`El servidor no respondió a /api/health en 45 s:\n${salida}`);
    }
    console.log('  1/4  arranca y responde /api/health');

    // ---- 2. Login (ruta pública) -------------------------------------------
    const login = await pedir('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: correo, password: clave }),
    });
    diagnosticar500(login.status, login.cuerpo, 'POST /auth/login');
    if (login.status !== 200 || typeof login.cuerpo?.access_token !== 'string') {
      throw new Error(
        `El login devolvió ${login.status}: ${resumen(login.cuerpo)}\n` +
          '  ¿Existe la clínica de demostración y coincide DEMO_OWNER_PASSWORD? (npm run db:seed-demo)',
      );
    }
    console.log('  2/4  login correcto');
    const auth = { authorization: `Bearer ${login.cuerpo.access_token}` };

    // ---- 3. Ruta AUTENTICADA (aquí es donde fallaba tsx) -------------------
    const sesion = await pedir('/auth/sesion', { headers: auth });
    diagnosticar500(sesion.status, sesion.cuerpo, 'GET /auth/sesion');
    if (sesion.status !== 200) {
      throw new Error(`GET /auth/sesion devolvió ${sesion.status}: ${resumen(sesion.cuerpo)}`);
    }
    const clinicas = sesion.cuerpo?.tenants;
    if (!Array.isArray(clinicas) || clinicas.length === 0) {
      throw new Error(
        `La sesión no trae clínicas: ${resumen(sesion.cuerpo)}\n` +
          '  ¿La membresía del usuario está activa? (npm run db:seed-demo)',
      );
    }
    console.log(`  3/4  sesión resuelta (${clinicas.length} clínica/s: ${clinicas[0]?.nombre})`);

    // ---- 4. Ruta de dominio con el guard de tenant -------------------------
    const pacientes = await pedir('/pacientes', {
      headers: { ...auth, 'x-tenant-id': String(clinicas[0].id) },
    });
    diagnosticar500(pacientes.status, pacientes.cuerpo, 'GET /pacientes');
    if (pacientes.status !== 200) {
      throw new Error(`GET /pacientes devolvió ${pacientes.status}: ${resumen(pacientes.cuerpo)}`);
    }
    if (!Array.isArray(pacientes.cuerpo)) {
      throw new Error(`GET /pacientes no devolvió una lista: ${resumen(pacientes.cuerpo)}`);
    }
    console.log(`  4/4  lectura autenticada con X-Tenant-Id (${pacientes.cuerpo.length} paciente/s)`);

    console.log('\n  Arranque correcto.\n');
  } finally {
    hijo.kill();
  }
}

main().catch((e) => {
  console.error(`\n  FALLO EN LA COMPROBACIÓN DE ARRANQUE\n\n  ${e.message}\n`);
  process.exit(1);
});
