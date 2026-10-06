/**
 * Traducción de errores de la API a mensajes utilizables.
 *
 * Existe para centralizar una sola política. Antes cada store repetía su propio
 * `fail()` con `String(message)`, y como Nest devuelve `message` como **array**
 * cuando falla la validación, el resultado era ilegible:
 * `"hora debe ser HH:MM,must be a string"`.
 */

interface ConRespuesta {
  response?: { status?: number; data?: { message?: unknown } }
}

/** Mensaje legible, con los errores de validación unidos por ` · `. */
export function mensajeDeError(e: unknown, porDefecto = 'Ocurrió un error'): string {
  const m = (e as ConRespuesta)?.response?.data?.message
  if (Array.isArray(m)) {
    const limpio = m.filter((x): x is string => typeof x === 'string' && x.length > 0)
    if (limpio.length > 0) return limpio.join(' · ')
  }
  if (typeof m === 'string' && m.length > 0) return m
  if (e instanceof Error && e.message.length > 0) return e.message
  return porDefecto
}

/** 404 también significa «es de otra clínica»: el backend no revela existencia. */
export function esNoEncontrado(e: unknown): boolean {
  return (e as ConRespuesta)?.response?.status === 404
}

/** 403 = falta permiso, o el plan no habilita la operación. */
export function esProhibido(e: unknown): boolean {
  return (e as ConRespuesta)?.response?.status === 403
}

/** 401 = sesión inválida o expirada. */
export function esNoAutorizado(e: unknown): boolean {
  return (e as ConRespuesta)?.response?.status === 401
}

/** 409 = conflicto: duplicado o carrera (el usuario suele poder reintentar). */
export function esConflicto(e: unknown): boolean {
  return (e as ConRespuesta)?.response?.status === 409
}
