<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useHuntsStore } from '@/stores/hunts'

const { t } = useI18n()
const router = useRouter()
const huntsStore = useHuntsStore()

const name = ref('')
const city = ref('Warszawa')
const saving = ref(false)
const error = ref<string | null>(null)

async function submit() {
  saving.value = true
  error.value = null
  try {
    const hunt = await huntsStore.createHunt(name.value.trim(), city.value.trim())
    await router.replace({ name: 'settings', params: { huntId: hunt.id } })
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="mx-auto max-w-lg px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-10">
    <RouterLink :to="{ name: 'hunts' }" class="text-sm text-brand-700"
      >‹ {{ t('common.back') }}</RouterLink
    >
    <h1 class="mt-2 mb-6 text-2xl font-bold">{{ t('hunts.new') }}</h1>
    <form class="space-y-4" @submit.prevent="submit">
      <div>
        <label class="label" for="name">{{ t('hunts.name') }}</label>
        <input
          id="name"
          v-model="name"
          required
          maxlength="100"
          class="input"
          :placeholder="t('hunts.namePlaceholder')"
        />
      </div>
      <div>
        <label class="label" for="city">{{ t('hunts.city') }}</label>
        <input id="city" v-model="city" required class="input" />
      </div>
      <button type="submit" class="btn-primary w-full" :disabled="saving">
        {{ saving ? t('common.saving') : t('hunts.create') }}
      </button>
      <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>
    </form>
  </main>
</template>
