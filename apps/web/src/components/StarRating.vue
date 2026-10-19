<script setup lang="ts">
import { useI18n } from 'vue-i18n'

// 1–5 stars; tapping the current rating clears it.
const props = withDefaults(
  defineProps<{ modelValue: number | null; size?: 'sm' | 'lg'; disabled?: boolean }>(),
  { size: 'lg' },
)
const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()
const { t } = useI18n()

function pick(n: number) {
  emit('update:modelValue', props.modelValue === n ? null : n)
}
</script>

<template>
  <div class="flex items-center" role="group" :aria-label="t('votes.stars')">
    <button
      v-for="n in 5"
      :key="n"
      type="button"
      class="leading-none transition active:scale-90 disabled:opacity-40"
      :class="[
        size === 'lg' ? 'px-1 text-3xl' : 'px-0.5 text-2xl',
        n <= (modelValue ?? 0) ? 'text-amber-400' : 'text-slate-300',
      ]"
      :aria-label="t('votes.rate', n)"
      :aria-pressed="modelValue === n"
      :disabled="disabled"
      @click.stop="pick(n)"
    >
      ★
    </button>
  </div>
</template>
