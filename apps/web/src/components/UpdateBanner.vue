<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { applyUpdate, updateReady } from '@/lib/appUpdate'

// Shown on every screen once a new version is installed and waiting.
const { t } = useI18n()
const dismissed = ref(false)
const updating = ref(false)

async function update() {
  updating.value = true
  await applyUpdate()
}
</script>

<template>
  <div
    v-if="updateReady && !dismissed"
    class="fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[2000] mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl"
    role="status"
    data-testid="update-banner"
  >
    <span class="flex-1">{{ t('appUpdate.ready') }}</span>
    <button type="button" class="text-slate-300" @click="dismissed = true">
      {{ t('appUpdate.later') }}
    </button>
    <button
      type="button"
      class="rounded-xl bg-brand-500 px-3 py-1.5 font-semibold text-white"
      :disabled="updating"
      @click="update"
    >
      {{ updating ? t('appUpdate.updating') : t('appUpdate.update') }}
    </button>
  </div>
</template>
