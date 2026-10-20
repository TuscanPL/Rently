<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { supabase } from '@/lib/supabase'

interface Preview {
  hunt_id: string
  hunt_name: string
  invited_by: string
  is_valid: boolean
  already_member: boolean
}

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const token = route.params.token as string

const preview = ref<Preview | null>(null)
const loading = ref(true)
const joining = ref(false)
const error = ref<string | null>(null)

onMounted(async () => {
  const { data, error: err } = await supabase.rpc('invite_preview', { p_token: token })
  if (err) error.value = err.message
  preview.value = data?.[0] ?? null
  loading.value = false
})

async function join() {
  joining.value = true
  error.value = null
  const { data, error: err } = await supabase.rpc('redeem_invite', { p_token: token })
  joining.value = false
  if (err) {
    error.value = err.message
    return
  }
  await router.replace({ name: 'deck', params: { huntId: data } })
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12 text-center">
    <h1 class="mb-6 text-2xl font-bold">{{ t('join.title') }}</h1>
    <p v-if="loading" class="text-slate-500">{{ t('common.loading') }}</p>

    <div v-else-if="preview?.already_member" class="card space-y-4">
      <p>{{ t('join.already') }}</p>
      <RouterLink
        :to="{ name: 'deck', params: { huntId: preview.hunt_id } }"
        class="btn-primary w-full"
      >
        {{ t('join.open') }}
      </RouterLink>
    </div>

    <div v-else-if="preview?.is_valid" class="card space-y-4">
      <p class="text-slate-600">{{ t('join.invitedBy', { name: preview.invited_by }) }}</p>
      <p class="text-xl font-semibold">{{ preview.hunt_name }}</p>
      <button type="button" class="btn-primary w-full" :disabled="joining" @click="join">
        {{ joining ? t('join.joining') : t('join.accept') }}
      </button>
    </div>

    <p v-else class="card text-slate-600">{{ t('join.invalid') }}</p>

    <p v-if="error" class="mt-4 text-sm text-rose-700" role="alert">{{ error }}</p>
  </main>
</template>
