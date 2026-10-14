import * as moduloKRGlue from '@lyracom/embedded-form-glue'

type Glue = typeof moduloKRGlue.default & {
  loaded: boolean
  loading: boolean
  publicKey: string | null
  formToken: string | null
  domain: string | null
}

/** La versión 1.4.4 exporta exports.default (CommonJS), no module.exports.
 * Vite/Node pueden envolverlo en uno o más niveles default. Resolver el objeto
 * por su API evita llamar loadLibrary sobre el namespace y permite limpiar
 * el mismo singleton que realmente creó el formulario.
 */
export function resolverKRGlue(modulo: unknown): Glue {
  let candidato = modulo
  for (let nivel = 0; nivel < 4; nivel++) {
    if (!candidato || typeof candidato !== 'object') break
    const objeto = candidato as Record<string, unknown>
    if (typeof objeto.loadLibrary === 'function') return candidato as Glue
    candidato = objeto.default
  }
  throw new Error('No se pudo inicializar la librería KRGlue de Izipay')
}

export const KRGlue = resolverKRGlue(moduloKRGlue)
