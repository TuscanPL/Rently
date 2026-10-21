<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import NotificationSettings from '@/components/NotificationSettings.vue'
import InstallPrompt from '@/components/InstallPrompt.vue'
import AppVersion from '@/components/AppVersion.vue'

const { t } = useI18n()
const auth = useAuthStore()
const router = useRouter()

const name = ref('')
const saving = ref(false)
const saved = ref(false)
const error = ref<string | null>(null)

watchEffect(() => {
  if (auth.profile) name.value = auth.profile.display_name
})

async function save() {
  saving.value = true
  error.value = null
  try {
    await auth.updateDisplayName(name.value.trim())
    saved.value = true
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

async function signOut() {
  await auth.signOut()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <main class="mx-auto max-w-lg px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-10">
    <RouterLink :to="{ name: 'hunts' }" class="text-sm text-brand-700"
      >‹ {{ t('common.back') }}</RouterLink
    >
    <h1 class="mt-2 mb-6 text-2xl font-bold">{{ t('account.title') }}</h1>
    <p class="mb-4 text-sm text-slate-500">{{ auth.session?.user.email }}</p>
    <form class="space-y-4" @submit.prevent="save">
      <div>
        <label class="label" for="display-name">{{ t('account.displayName') }}</label>
        <input
          id="display-name"
          v-model="name"
          required
          maxlength="60"
          class="input"
          @input="saved = false"
        />
        <p class="mt-1 text-xs text-slate-500">{{ t('account.displayNameHelp') }}</p>
      </div>
      <button type="submit" class="btn-primary w-full" :disabled="saving">
        {{ saved ? '✓' : saving ? t('common.saving') : t('common.save') }}
      </button>
      <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>
    </form>
    <NotificationSettings class="mt-8" />
    <InstallPrompt class="mt-8" />
    <AppVersion class="mt-8" />
    <button type="button" class="btn-secondary mt-8 w-full" @click="signOut">
      {{ t('auth.signOut') }}
    </button>
  </main>
</template>
