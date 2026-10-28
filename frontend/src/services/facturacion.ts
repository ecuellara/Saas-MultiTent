import api from './api'

/**
 * Suscripción y cobros del plan de la PROPIA clínica.
 *
 * La pasarela Izipay solo cobra suscripciones: `billing.manage`, nunca
 * `payments.write` (eso es cobrar a pacientes). El estado lo pone la IPN;
 * esta capa solo prepara el formulario y consulta el estado persistido.
 */

export interface PlanResumen {
  codigo: string
  nombre: string
  precioMensual: string | number
  moneda: string
}

export interface SuscripcionResumen {
  estado: string
  periodoInicio: string
  periodoFin: string
}

export interface CobroResumen {
  id: string
  monto: string | number
  moneda: string
  estado: string
  periodoInicio: string
  periodoFin: string
  proveedor: string | null
  /** Desglose del importe a cobrar (precio del plan + comisión de la pasarela). */
  comision?: string
  total?: string
}

export interface DesgloseImporte {
  precio: string
  comision: string
  total: string
  moneda: string
}

export interface MiPlan {
  plan: PlanResumen
  subscription: SuscripcionResumen
  cobroPendiente: CobroResumen | null
  cobros: CobroResumen[]
}

export async function obtenerMiPlan(): Promise<MiPlan> {
  const { data } = await api.get<MiPlan>('/facturacion/mi-plan')
  return data
}

export async function prepararPlanFormToken(): Promise<{ formToken: string; publicKey: string; cobroId: string; importe: DesgloseImporte }> {
  const { data } = await api.post<{ formToken: string; publicKey: string; cobroId: string; importe: DesgloseImporte }>('/facturacion/mi-plan/formtoken')
  return data
}

export async function validarRetornoPlan(resultado: KRPaymentResponse): Promise<{ valido: true; orderStatus: string }> {
  const { data } = await api.post<{ valido: true; orderStatus: string }>('/facturacion/mi-plan/validar-retorno', {
    'kr-answer': resultado.rawClientAnswer,
    'kr-hash': resultado.hash,
    'kr-hash-key': resultado.hashKey,
    'kr-hash-algorithm': resultado.hashAlgorithm,
  }, { silencioso: true })
  return data
}
