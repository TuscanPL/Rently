<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { installed, installEvent, isIos, promptInstall } from '@/lib/install'
import { INSTALL_DISMISSED_KEY, readLocal, writeLocal } from '@/lib/storage'

// "Install app" card: Chrome's install prompt where available, the Add to Home
// Screen steps on iOS, nothing once installed. `dismissible` (hunts list) lets
// the user hide it for good; the account page always shows it.
const props = defineProps<{ dismissible?: boolean }>()
const { t } = useI18n()

const dismissed = ref(props.dismissible && readLocal(INSTALL_DISMISSED_KEY) === '1')
const ios = isIos()
const icon = `${import.meta.env.BASE_URL}pwa-192.png`
const visible = computed(
  () => !installed.value && !dismissed.value && (installEvent.value !== null || ios),
)

function dismiss() {
  dismissed.value = true
  writeLocal(INSTALL_DISMISSED_KEY, '1')
}
</script>

<template>
  <div v-if="visible" class="card flex items-start gap-3" data-testid="install-prompt">
    <img :src="icon" alt="" class="h-10 w-10 shrink-0 rounded-xl" />
    <div class="min-w-0 flex-1">
      <p class="font-semibold">{{ t('install.title') }}</p>
      <p class="text-sm text-slate-600">
        {{ installEvent ? t('install.body') : t('install.ios') }}
      </p>
      <button
        v-if="installEvent"
        type="button"
        class="btn-primary mt-3 py-2"
        @click="promptInstall"
      >
        {{ t('install.button') }}
      </button>
    </div>
    <button
      v-if="dismissible"
      type="button"
      class="-mt-1 -mr-1 px-1 text-xl leading-none text-slate-400"
      :aria-label="t('install.dismiss')"
      @click="dismiss"
    >
      ×
    </button>
  </div>
</template>
