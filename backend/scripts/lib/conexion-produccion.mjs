export function conexionDirecta(entorno) {
  const valor = entorno.DIRECT_URL;
  if (!valor) throw new Error('DIRECT_URL es obligatoria para migraciones y seed de producción');
  let url;
  try { url = new URL(valor); } catch { throw new Error('DIRECT_URL no es una URL PostgreSQL válida'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.port !== '5432' ||
      !url.hostname.startsWith('db.') || !url.hostname.endsWith('.supabase.co')) {
    throw new Error('DIRECT_URL debe ser la conexión directa db.<project-ref>.supabase.co:5432, no el pooler');
  }
  if (url.searchParams.get('sslmode') !== 'require') throw new Error('DIRECT_URL debe incluir sslmode=require');
  return valor;
}
