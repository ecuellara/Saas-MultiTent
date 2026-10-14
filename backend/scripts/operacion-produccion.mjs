import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { conexionDirecta } from './lib/conexion-produccion.mjs';

const require = createRequire(import.meta.url);
const raiz = fileURLToPath(new URL('../', import.meta.url));
try {
  const directa = conexionDirecta(process.env);
  const operacion = process.argv[2];
  let args;
  if (operacion === 'migrate') args = [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'];
  else if (operacion === 'seed') args = [require.resolve('tsx/cli'), 'prisma/seed.ts'];
  else throw new Error('Operación admitida: migrate o seed (nunca seed-demo)');
  const hijo = spawn(process.execPath, args, { cwd: raiz, stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: directa, DIRECT_URL: directa } });
  hijo.on('error', () => { console.error('No se pudo iniciar el CLI. Instale con npm ci --include=dev'); process.exitCode = 1; });
  hijo.on('exit', (codigo) => { process.exitCode = codigo ?? 1; });
} catch (e) { console.error(e.message); process.exitCode = 1; }
