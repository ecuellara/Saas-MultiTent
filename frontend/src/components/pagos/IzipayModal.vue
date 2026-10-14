<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { prepararIzipay, validarRetornoIzipay } from '../../services/pagos'
import { montarSmartForm, type FormularioIzipay } from '../../services/izipay-form'
import { mensajeDeError } from '../../services/errores'
import AvisoError from '../ui/AvisoError.vue'
import ModalBase from '../ui/ModalBase.vue'

const props = defineProps<{ pagoId: string }>()
const emit = defineEmits<{ cerrar: [mensaje: string]; revisar: []; exito: [] }>()
const error = ref('')
const mensaje = ref('Preparando formulario seguro…')
let activo = true
let resultadoRecibido = false
let formulario: FormularioIzipay | undefined
let aceptado = false

function cerrar(): void {
  emit('cerrar', aceptado ? 'Pago pendiente de confirmar. El estado se actualizará cuando llegue la notificación de Izipay.' : resultadoRecibido ? 'Pago rechazado. No se ha confirmado ningún cobro en línea.' : 'Pago cancelado por el usuario. Si ya envió el pago, su confirmación puede llegar después.')
}

onMounted(async () => {
  try {
    const { formToken, publicKey } = await prepararIzipay(props.pagoId)
    if (!activo) return
    formulario = montarSmartForm({
      formToken, publicKey,
      alResultado: async (resultado) => {
        if (!activo || aceptado) return
        mensaje.value = 'Verificando la respuesta de Izipay…'
        try {
          const validacion = await validarRetornoIzipay(props.pagoId, resultado)
          if (!activo) return
          error.value = ''
          resultadoRecibido = true
          aceptado = validacion.orderStatus === 'PAID'
          mensaje.value = aceptado
            ? 'Pago pendiente de confirmar. Esperando la notificación de Izipay.'
            : 'Pago rechazado. Puede volver a intentar o cerrar el formulario.'
          if (aceptado) emit('exito')
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
  <ModalBase titulo="Cobrar en línea" @cerrar="cerrar">
    <AvisoError v-if="error" :mensaje="error" class="mb-3" />
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
