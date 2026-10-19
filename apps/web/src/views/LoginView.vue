<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { POST_LOGIN_KEY, readLocal } from '@/lib/storage'

const { t } = useI18n()
const auth = useAuthStore()
const router = useRouter()

const email = ref('')
const sending = ref(false)
const sent = ref(false)
const error = ref<string | null>(auth.authError)
const logoUrl = `${import.meta.env.BASE_URL}favicon.svg`
const googleEnabled = import.meta.env.VITE_GOOGLE_AUTH === 'true'
const joining = computed(() => readLocal(POST_LOGIN_KEY)?.startsWith('/join/') ?? false)

// Signing in from another tab (or finishing OAuth) moves on automatically.
watch(
  () => auth.session,
  (s) => {
    if (s) void router.replace({ name: 'login' })
  },
)

async function sendLink() {
  sending.value = true
  error.value = null
  try {
    await auth.sendMagicLink(email.value.trim())
    sent.value = true
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    sending.value = false
  }
}

// The email also has a code: for an installed PWA, the link may open in another browser.
const enteringCode = ref(false)
const code = ref('')

async function submitCode() {
  sending.value = true
  error.value = null
  try {
    await auth.verifyCode(email.value.trim(), code.value)
    // Already on the login route, so the session watcher's replace({ name: 'login' }) is a no-op.
    await router.replace('/')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    sending.value = false
  }
}

async function google() {
  error.value = null
  try {
    await auth.signInWithGoogle()
  } catch (e) {
    error.value = (e as Error).message
  }
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12">
    <div class="mb-8 text-center">
      <img :src="logoUrl" alt="" class="mx-auto mb-4 h-16 w-16" />
      <h1 class="text-2xl font-bold">{{ t('app.name') }}</h1>
      <p class="mt-1 text-slate-600">{{ t('app.tagline') }}</p>
    </div>

    <p v-if="joining" class="mb-4 rounded-xl bg-brand-50 p-3 text-sm text-brand-800">
      {{ t('auth.joinHint') }}
    </p>

    <div v-if="sent" class="card text-center" data-testid="link-sent">
      <p class="text-4xl">📬</p>
      <p class="mt-2">{{ t('auth.linkSent') }}</p>
      <form v-if="enteringCode" class="mt-4 space-y-3 text-left" @submit.prevent="submitCode">
        <div>
          <label class="label" for="code">{{ t('auth.code') }}</label>
          <input
            id="code"
            v-model="code"
            required
            inputmode="numeric"
            autocomplete="one-time-code"
            class="input tracking-widest"
          />
        </div>
        <button type="submit" class="btn-primary w-full" :disabled="sending">
          {{ sending ? t('auth.verifying') : t('auth.verifyCode') }}
        </button>
      </form>
      <button
        v-else
        type="button"
        class="mt-3 text-sm font-medium text-brand-700 hover:underline"
        @click="enteringCode = true"
      >
        {{ t('auth.haveCode') }}
      </button>
    </div>

    <form v-else class="space-y-4" @submit.prevent="sendLink">
      <div>
        <label class="label" for="email">{{ t('auth.email') }}</label>
        <input
          id="email"
          v-model="email"
          type="email"
          required
          autocomplete="email"
          inputmode="email"
          class="input"
          :placeholder="t('auth.emailPlaceholder')"
        />
      </div>
      <button type="submit" class="btn-primary w-full" :disabled="sending">
        {{ sending ? t('auth.sending') : t('auth.sendLink') }}
      </button>

      <template v-if="googleEnabled">
        <div class="flex items-center gap-3 text-xs text-slate-400">
          <span class="h-px flex-1 bg-slate-200" />{{ t('auth.or')
          }}<span class="h-px flex-1 bg-slate-200" />
        </div>
        <button type="button" class="btn-secondary w-full" @click="google">
          {{ t('auth.google') }}
        </button>
      </template>
    </form>

    <p v-if="error" class="mt-4 text-sm text-rose-700" role="alert">{{ error }}</p>
  </main>
</template>
