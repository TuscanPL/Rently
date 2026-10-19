<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NOTIFICATION_KINDS, type NotificationKind } from '@at/shared'
import { useNotificationsStore } from '@/stores/notifications'
import { currentSubscription, disablePush, enablePush, pushSupport } from '@/lib/push'
import { isIos } from '@/lib/install'

// Account page: Web Push on this device, and which kinds of notification to get
// at all (the switches apply to push and to the in-app feed).
const { t } = useI18n()
const store = useNotificationsStore()

const support = ref(pushSupport())
const subscribed = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    await store.loadPrefs()
    subscribed.value = !!(await currentSubscription())
  } catch (e) {
    error.value = (e as Error).message
  }
})

async function run(action: () => Promise<void>) {
  busy.value = true
  error.value = null
  try {
    await action()
  } catch (e) {
    const message = (e as Error).message
    error.value = message === 'permission' ? t('push.permissionDenied') : message
  } finally {
    support.value = pushSupport()
    busy.value = false
  }
}

const enable = () =>
  run(async () => {
    await enablePush()
    subscribed.value = true
  })

const disable = () =>
  run(async () => {
    await disablePush()
    subscribed.value = false
  })

function toggle(kind: NotificationKind, event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  void store.setPref(kind, checked).catch((e: Error) => (error.value = e.message))
}
</script>

<template>
  <section class="space-y-4" data-testid="notification-settings">
    <h2 class="text-lg font-semibold">{{ t('notifications.settingsTitle') }}</h2>

    <div class="card space-y-3">
      <div class="flex items-start gap-3">
        <span class="text-2xl" aria-hidden="true">🔔</span>
        <div class="min-w-0 flex-1">
          <p class="font-semibold">{{ t('push.title') }}</p>
          <p class="text-sm text-slate-600" data-testid="push-status">
            <template v-if="support === 'ok'">
              {{ subscribed ? t('push.on') : t('push.off') }}
            </template>
            <template v-else-if="support === 'unsupported'">
              {{ isIos() ? t('push.iosInstallFirst') : t('push.unsupported') }}
            </template>
            <template v-else>{{ t(`push.${support}`) }}</template>
          </p>
        </div>
      </div>
      <template v-if="support === 'ok'">
        <button
          v-if="!subscribed"
          type="button"
          class="btn-primary w-full"
          :disabled="busy"
          @click="enable"
        >
          {{ t('push.enable') }}
        </button>
        <button v-else type="button" class="btn-secondary w-full" :disabled="busy" @click="disable">
          {{ t('push.disable') }}
        </button>
      </template>
    </div>

    <fieldset class="card space-y-1">
      <legend class="sr-only">{{ t('notifications.kindsLegend') }}</legend>
      <p class="mb-2 text-sm text-slate-600">{{ t('notifications.kindsHelp') }}</p>
      <label
        v-for="kind in NOTIFICATION_KINDS"
        :key="kind"
        class="flex items-center justify-between gap-3 py-2 text-sm"
      >
        <span>{{ t(`notifications.kindLabel.${kind}`) }}</span>
        <input
          type="checkbox"
          role="switch"
          class="h-5 w-5 shrink-0 accent-brand-700"
          :checked="store.prefs?.[kind] ?? true"
          :disabled="!store.prefs"
          @change="toggle(kind, $event)"
        />
      </label>
    </fieldset>

    <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>
  </section>
</template>
