import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verificarConfiguracion } from '../scripts/vercel-config.mjs';

const correcto = { rewrites: [
  { source: '/api/:path*', destination: 'https://prueba-config.onrender.com/api/:path*' },
  { source: '/(.*)', destination: '/index.html' },
] };
test('proxy API precede al fallback SPA y conserva API relativa', () => {
  assert.equal(verificarConfiguracion(correcto, { VITE_API_URL: '' }), 'https://prueba-config.onrender.com');
  assert.throws(() => verificarConfiguracion(correcto, { VITE_API_URL: 'https://prueba-config.onrender.com/api' }), /VACÍA/);
  assert.throws(() => verificarConfiguracion({ rewrites: [...correcto.rewrites].reverse() }, {}), /primero/);
  assert.throws(() => verificarConfiguracion({ rewrites: [
    { ...correcto.rewrites[0], destination: 'https://configurar-api-render.onrender.com/api/:path*' }, correcto.rewrites[1],
  ] }, {}), /origen real/);
});
