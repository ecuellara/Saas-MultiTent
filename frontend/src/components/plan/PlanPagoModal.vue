<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { prepararPlanFormToken, validarRetornoPlan, type DesgloseImporte } from '../../services/facturacion'
import { montarSmartForm, type FormularioIzipay } from '../../services/izipay-form'
import { formatoMoneda } from '../../services/pagos'
import { mensajeDeError } from '../../services/errores'
import AvisoError from '../ui/AvisoError.vue'
import ModalBase from '../ui/ModalBase.vue'

/** Modal de pago del PLAN (cobro de suscripción). Parametrizado por el cobro
 * que devuelve el backend; nunca recibe importes del exterior. */
const emit = defineEmits<{ cerrar: [mensaje: string]; revisar: []; exito: [cobroId: string] }>()
const error = ref('')
const mensaje = ref('Preparando formulario seguro…')
const desglose = ref<DesgloseImporte | null>(null)
let activo = true
let resultadoRecibido = false
let formulario: FormularioIzipay | undefined
let aceptado = false
let cobroId = ''

function cerrar(): void {
  activo = false
  void formulario?.destruir()
  emit('cerrar', aceptado ? 'Pago pendiente de confirmar. El estado se actualizará cuando llegue la notificación de Izipay.' : resultadoRecibido ? 'Pago rechazado. No se ha confirmado ningún cobro en línea.' : 'Pago cancelado por el usuario. Si ya envió el pago, su confirmación puede llegar después.')
}

onMounted(async () => {
  try {
    const preparado = await prepararPlanFormToken()
    cobroId = preparado.cobroId
    desglose.value = preparado.importe
    if (!activo) return
    formulario = montarSmartForm({
      formToken: preparado.formToken, publicKey: preparado.publicKey,
      alResultado: async (resultado) => {
        if (!activo || aceptado) return
        mensaje.value = 'Verificando la respuesta de Izipay…'
        try {
          const validacion = await validarRetornoPlan(resultado)
          if (!activo) return
          error.value = ''
          resultadoRecibido = true
          aceptado = validacion.orderStatus === 'PAID'
          mensaje.value = aceptado
            ? 'Pago pendiente de confirmar. Esperando la notificación de Izipay.'
            : 'Pago rechazado. Puede volver a intentar o cerrar el formulario.'
          if (aceptado) emit('exito', cobroId)
          else emit('revisar')
        } catch (e) {
          if (activo) {
            error.value = mensajeDeError(e, 'No se pudo verificar la respuesta del pago')
            mensaje.value = 'Resultado sin verificar. Actualice el estado para consultar la confirmación del servidor.'
            emit('revisar')
          }
        }
      },
      alError: () => { error.value = 'Pago rechazado o no completado. Revise los datos o vuelva a intentar.' },
    })
    await formulario.listo
    if (!activo) return
    mensaje.value = 'Complete el pago en el formulario seguro de Izipay.'
  } catch (e) {
    if (activo) {
      error.value = mensajeDeError(e, 'No se pudo cargar el formulario de Izipay')
      mensaje.value = 'No se pudo preparar el cobro en línea.'
      void formulario?.destruir()
    }
  }
})

onBeforeUnmount(() => {
  activo = false
  void formulario?.destruir()
})
</script>

<template>
  <ModalBase titulo="Pagar el plan" @cerrar="cerrar">
    <AvisoError v-if="error" :mensaje="error" class="mb-3" />
    <div v-if="desglose" class="mb-3 rounded-lg border border-line bg-background p-3 text-sm">
      <p class="text-xs font-medium uppercase text-muted">Importe a pagar</p>
      <dl class="mt-2 space-y-1">
        <div class="flex justify-between gap-2">
          <dt class="text-muted">Precio del plan</dt>
          <dd class="text-ink">{{ formatoMoneda(desglose.precio) }}</dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="text-muted">Comisión de la pasarela</dt>
          <dd class="text-ink">{{ formatoMoneda(desglose.comision) }}</dd>
        </div>
        <div class="flex justify-between gap-2 border-t border-line pt-1 font-semibold">
          <dt class="text-ink">Total</dt>
          <dd class="text-ink">{{ formatoMoneda(desglose.total) }}</dd>
        </div>
      </dl>
      <p class="mt-2 text-xs text-muted">El importe incluye la comisión de la pasarela de pago, que asume la clínica.</p>
    </div>
    <p class="mb-3 text-sm text-muted" role="status">{{ mensaje }}</p>
    <div id="micuentawebstd_rest_wrapper">
      <div id="izipay-container"><div class="kr-smart-form" kr-card-form-expanded></div></div>
    </div>
    <div class="mt-4 flex justify-end gap-2">
      <button class="rounded-md border border-line px-3 py-2 text-sm" @click="emit('revisar')">Actualizar estado</button>
      <button class="rounded-md border border-line px-3 py-2 text-sm" @click="cerrar">Cerrar</button>
    </div>
  </ModalBase>
</template>
