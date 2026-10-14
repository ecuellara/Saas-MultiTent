import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { conexionDirecta } from '../lib/conexion-produccion.mjs';

test('migraciones/seed requieren conexión directa SSL y rechazan pooler sin exponer la URL', () => {
  const directa = 'postgresql://postgres:clave-ficticia@db.proyecto.supabase.co:5432/postgres?sslmode=require';
  assert.equal(conexionDirecta({ DIRECT_URL: directa }), directa);
  for (const valor of [undefined, 'invalida', directa.replace(':5432', ':6543'),
    directa.replace('db.proyecto.supabase.co', 'aws-0.pooler.supabase.com'), directa.replace('sslmode=require', 'sslmode=disable')]) {
    assert.throws(() => conexionDirecta({ DIRECT_URL: valor }), (e) => !e.message.includes('clave-ficticia'));
  }
});

test('CLI Prisma 7 y tsx resuelven sus ejecutables de producción', () => {
  const require = createRequire(import.meta.url);
  const prisma = require.resolve('prisma/build/index.js');
  const tsx = require.resolve('tsx/cli');
  assert.ok(tsx.endsWith('cli.mjs'));
  const ayuda = spawnSync(process.execPath, [prisma, 'migrate', 'deploy', '--help'], {
    encoding: 'utf8', env: { ...process.env, DATABASE_URL: 'postgresql://build:build@localhost:5432/build', DIRECT_URL: '' },
  });
  assert.equal(ayuda.status, 0);
  assert.match(ayuda.stdout, /migrate deploy/);
});
