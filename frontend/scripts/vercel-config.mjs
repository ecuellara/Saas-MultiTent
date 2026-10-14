import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function origenRender(valor) {
  let url;
  try { url = new URL(valor); } catch { throw new Error('Indique la URL HTTPS real de la API Render'); }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.onrender.com') || url.hostname === 'configurar-api-render.onrender.com' ||
      url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use el origen real https://<api>.onrender.com, sin /api ni credenciales');
  }
  return url.origin;
}

export function verificarConfiguracion(config, entorno) {
  if (entorno.VITE_API_URL?.trim()) throw new Error('VITE_API_URL debe estar VACÍA: el navegador utiliza /api en Vercel');
  const [api, spa] = config.rewrites ?? [];
  if (api?.source !== '/api/:path*' || !api.destination?.endsWith('/api/:path*') ||
      spa?.source !== '/(.*)' || spa.destination !== '/index.html') {
    throw new Error('El proxy /api debe ir primero y el fallback /index.html después');
  }
  return origenRender(api.destination.slice(0, -'/api/:path*'.length));
}

async function main() {
  const operacion = process.argv[2];
  if (operacion === 'verificar' && process.env.VERCEL !== '1') return; // Build local/staging conserva su configuración propia.
  const archivo = new URL('../vercel.json', import.meta.url);
  const config = JSON.parse(await readFile(archivo, 'utf8'));
  if (operacion === 'configurar') {
    const origen = origenRender(process.argv[3]);
    config.rewrites[0].destination = `${origen}/api/:path*`;
    await writeFile(archivo, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`Proxy configurado hacia ${origen}; publique este vercel.json antes del despliegue`);
  } else if (operacion === 'verificar') {
    verificarConfiguracion(config, process.env);
    console.log('Proxy Vercel y API relativa: correctos');
  } else throw new Error('Use configurar <URL-api-Render> o verificar');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
