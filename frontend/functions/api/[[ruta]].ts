type ContextoPages = {
  request: Request
  env: { API_ORIGIN?: string }
}

const CABECERAS_DE_SALTO = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
])

function errorJson(estado: number, mensaje: string): Response {
  return new Response(JSON.stringify({ statusCode: estado, message: mensaje }), {
    status: estado,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

export const onRequest = async ({ request, env }: ContextoPages): Promise<Response> => {
  const origen = (env.API_ORIGIN ?? '').trim().replace(/\/+$/, '')

  if (!origen) {
    return errorJson(500, 'Falta configurar la variable de entorno API_ORIGIN')
  }

  let base: URL
  try {
    base = new URL(origen)
  } catch {
    return errorJson(500, 'API_ORIGIN no es una URL válida')
  }

  if ((base.protocol !== 'https:' && base.protocol !== 'http:') || base.username || base.password) {
    return errorJson(500, 'API_ORIGIN debe ser un origen http(s) sin credenciales')
  }

  const entrada = new URL(request.url)
  const destino = new URL(`${base.origin}${entrada.pathname}${entrada.search}`)

  const cabeceras = new Headers(request.headers)
  for (const nombre of CABECERAS_DE_SALTO) cabeceras.delete(nombre)
  cabeceras.set('x-forwarded-host', entrada.host)
  cabeceras.set('x-forwarded-proto', entrada.protocol.slice(0, -1))
  // La IP real del cliente la fija Cloudflare en cf-connecting-ip y no es
  // falsificable desde fuera. Se reescribe x-forwarded-for con ella para que la
  // API cuente SIEMPRE los mismos saltos (el proxy de Render mas este) y
  // TRUST_PROXY=2 deje de depender de cuantos saltos internos use Cloudflare;
  // sin esto la auditoria acababa guardando la IP del borde.
  const ipCliente = request.headers.get('cf-connecting-ip')
  if (ipCliente) cabeceras.set('x-forwarded-for', ipCliente)

  const conCuerpo = request.method !== 'GET' && request.method !== 'HEAD'

  try {
    const respuesta = await fetch(destino.toString(), {
      method: request.method,
      headers: cabeceras,
      body: conCuerpo ? request.body : null,
      redirect: 'manual',
      ...(conCuerpo && request.body ? { duplex: 'half' as const } : {}),
    })

    return respuesta
  } catch {
    return errorJson(502, 'No se pudo contactar con la API')
  }
}
