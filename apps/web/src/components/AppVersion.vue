<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  APP_VERSION,
  BUILD_TIME,
  applyUpdate,
  checkForUpdate,
  checking,
  updateReady,
} from '@/lib/appUpdate'

// Account → App version: which build this is, and a manual update check.
const { t, d } = useI18n()
const result = ref<'current' | 'unavailable' | null>(null)

async function check() {
  result.value = null
  const outcome = await checkForUpdate()
  if (outcome !== 'ready') result.value = outcome
}
</script>

<template>
  <section class="card space-y-3" data-testid="app-version">
    <h2 class="font-semibold">{{ t('appUpdate.title') }}</h2>
    <p class="text-sm text-slate-600">
      {{ t('appUpdate.version', { version: APP_VERSION }) }} ·
      {{ t('appUpdate.built', { date: d(new Date(BUILD_TIME), 'long') }) }}
    </p>
    <button v-if="updateReady" type="button" class="btn-primary w-full" @click="applyUpdate">
      {{ t('appUpdate.updateNow') }}
    </button>
    <button v-else type="button" class="btn-secondary w-full" :disabled="checking" @click="check">
      {{ checking ? t('appUpdate.checking') : t('appUpdate.check') }}
    </button>
    <p v-if="result" class="text-sm text-slate-500" role="status">
      {{ t(`appUpdate.${result}`) }}
    </p>
  </section>
</template>
