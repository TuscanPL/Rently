<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

// Bottom sheet asking for an optional note before taking a listing back.
defineProps<{ busy?: boolean; error?: string | null }>()
const emit = defineEmits<{ submit: [note: string]; close: [] }>()
const { t } = useI18n()
const note = ref('')
const input = ref<HTMLTextAreaElement | null>(null)

onMounted(() => input.value?.focus())
</script>

<template>
  <div
    class="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 sm:items-center"
    @click.self="emit('close')"
    @keydown.esc="emit('close')"
  >
    <form
      role="dialog"
      aria-modal="true"
      aria-labelledby="reconsider-title"
      class="w-full max-w-md space-y-3 rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl sm:rounded-3xl"
      @submit.prevent="emit('submit', note)"
    >
      <h2 id="reconsider-title" class="text-lg font-semibold">{{ t('reconsider.title') }}</h2>
      <p class="text-sm text-slate-600">{{ t('reconsider.help') }}</p>
      <div>
        <label class="label" for="reconsider-note">{{ t('reconsider.noteLabel') }}</label>
        <textarea
          id="reconsider-note"
          ref="input"
          v-model="note"
          class="input"
          rows="2"
          maxlength="500"
          :placeholder="t('reconsider.notePlaceholder')"
        ></textarea>
      </div>
      <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>
      <div class="flex gap-3">
        <button type="button" class="btn-secondary flex-1" @click="emit('close')">
          {{ t('common.cancel') }}
        </button>
        <button type="submit" class="btn-primary flex-1" :disabled="busy">
          {{ t('reconsider.submit') }}
        </button>
      </div>
    </form>
  </div>
</template>
