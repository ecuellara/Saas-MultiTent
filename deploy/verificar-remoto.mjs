import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function pdfPrueba10MB() {
  const contenido = Buffer.concat([Buffer.from('BT /F1 12 Tf 40 700 Td (Verificacion de despliegue 10 MB) Tj ET\n'),
    Buffer.alloc(10 * 1024 * 1024, 32)]);
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    Buffer.concat([Buffer.from(`<< /Length ${contenido.length} >>\nstream\n`), contenido, Buffer.from('\nendstream')]),
  ];
  const partes = [Buffer.from('%PDF-1.4\n')];
  const offsets = [0];
  let longitud = partes[0].length;
  objetos.forEach((objeto, i) => {
    offsets.push(longitud);
    const parte = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), Buffer.from(objeto), Buffer.from('\nendobj\n')]);
    partes.push(parte); longitud += parte.length;
  });
  const xref = `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  partes.push(Buffer.from(`${xref}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${longitud}\n%%EOF\n`));
  return Buffer.concat(partes);
}

function origen(nombre) {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta ${nombre}`);
  let url;
  try { url = new URL(valor); } catch { throw new Error(`${nombre} debe ser un origen HTTPS`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${nombre} debe ser un origen HTTPS, sin /api ni credenciales`);
  }
  return url.origin;
}
function cabeceras() {
  if (!process.env.ACCESS_TOKEN || !process.env.TENANT_ID) throw new Error('Faltan ACCESS_TOKEN y TENANT_ID (configúrelos en el entorno, nunca en archivos versionados)');
  return { Authorization: `Bearer ${process.env.ACCESS_TOKEN}`, 'X-Tenant-Id': process.env.TENANT_ID };
}
function id(nombre) {
  if (!process.env[nombre]) throw new Error(`Falta ${nombre}`);
  return encodeURIComponent(process.env[nombre]);
}

async function descarga(base, documentoId, esperado) {
  const r = await fetch(`${base}/api/pacientes/${id('PACIENTE_ID')}/documentos/${encodeURIComponent(documentoId)}/descarga`,
    { headers: cabeceras(), signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`Descarga HTTP ${r.status}`);
  const recibido = Buffer.from(await r.arrayBuffer());
  if (!recibido.equals(esperado)) throw new Error('Los bytes descargados no coinciden con el PDF subido');
  console.log(JSON.stringify({ descarga: 'correcta', bytes: recibido.length,
    sha256: createHash('sha256').update(recibido).digest('hex') }));
}

async function main() {
  const modo = process.argv[2];
  if (modo === 'health') {
    for (const nombre of ['API_PUBLIC_URL', 'FRONTEND_PUBLIC_URL']) {
      const r = await fetch(`${origen(nombre)}/api/health`, { signal: AbortSignal.timeout(120000) });
      const data = await r.json();
      if (!r.ok || data.status !== 'ok' || data.database !== 'ok') throw new Error(`Health de ${nombre} no está sano (HTTP ${r.status})`);
      console.log(`${nombre}: health y base correctos`);
    }
  } else if (modo === 'subida') {
    // Primero probar Vercel. Solo tras fallo y evidencia probar BASE_SUBIDA=Render.
    const base = origen(process.env.BASE_SUBIDA ? 'BASE_SUBIDA' : 'FRONTEND_PUBLIC_URL');
    const pdf = pdfPrueba10MB();
    const form = new FormData();
    form.append('tipo', 'OTRO');
    form.append('archivo', new Blob([pdf], { type: 'application/pdf' }), 'verificacion-10mb.pdf');
    const r = await fetch(`${base}/api/pacientes/${id('PACIENTE_ID')}/documentos/archivo`, {
      method: 'POST', headers: cabeceras(), body: form, signal: AbortSignal.timeout(120000),
    });
    console.log(JSON.stringify({ subidaHttp: r.status, bytesEnviados: pdf.length }));
    if (r.status !== 201) throw new Error('Subida no aceptada. Conserve status y logs del proxy/API; no dé por probados los 20 MB');
    const documento = await r.json();
    if (typeof documento.id !== 'string') throw new Error('La subida no devolvió el id del documento');
    console.log(`DOCUMENTO_ID=${documento.id}`);
    await descarga(base, documento.id, pdf);
  } else if (modo === 'persistencia') {
    if (!process.env.DOCUMENTO_ID) throw new Error('Falta DOCUMENTO_ID de la subida previa al redespliegue');
    await descarga(origen('FRONTEND_PUBLIC_URL'), process.env.DOCUMENTO_ID, pdfPrueba10MB());
  } else throw new Error('Use health, subida o persistencia');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
