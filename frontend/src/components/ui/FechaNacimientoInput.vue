<script setup lang="ts">
import FechaInput from './FechaInput.vue'
import { hoyLima } from '../../services/fechas'

withDefaults(defineProps<{ modelValue?: string | null; id?: string }>(), { modelValue: '', id: 'fecha-nacimiento' })
const emit = defineEmits<{ 'update:modelValue': [string] }>()
</script>

<template>
  <FechaInput :id="id" :model-value="modelValue" min="1900-01-01" :max="hoyLima()"
    aria-label="Seleccionar fecha de nacimiento" @update:model-value="emit('update:modelValue', $event)" />
</template>
