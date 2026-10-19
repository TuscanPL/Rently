<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useHuntsStore } from '@/stores/hunts'
import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()
const huntsStore = useHuntsStore()
const auth = useAuthStore()
const loading = ref(true)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    await huntsStore.fetchHunts()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <main class="mx-auto max-w-lg px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-10">
    <header class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-bold">{{ t('hunts.title') }}</h1>
      <RouterLink
        :to="{ name: 'account' }"
        class="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-800"
        :aria-label="t('account.title')"
      >
        {{ auth.profile?.display_name.charAt(0).toUpperCase() ?? '?' }}
      </RouterLink>
    </header>

    <p v-if="loading" class="text-slate-500">{{ t('common.loading') }}</p>
    <p v-else-if="error" class="text-rose-700">{{ t('common.error', { message: error }) }}</p>
    <template v-else>
      <p v-if="huntsStore.hunts.length === 0" class="card mb-4 text-slate-600">
        {{ t('hunts.empty') }}
      </p>
      <ul class="space-y-3">
        <li v-for="hunt in huntsStore.hunts" :key="hunt.id">
          <RouterLink
            :to="{ name: 'deck', params: { huntId: hunt.id } }"
            class="card flex items-center justify-between hover:border-brand-500"
          >
            <span>
              <span class="block font-semibold">{{ hunt.name }}</span>
              <span class="text-sm text-slate-500">
                {{ hunt.city }} ·
                {{ t('hunts.members', hunt.hunt_members[0]?.count ?? 0) }}
              </span>
            </span>
            <span aria-hidden="true" class="text-slate-400">›</span>
          </RouterLink>
        </li>
      </ul>
    </template>

    <RouterLink :to="{ name: 'new-hunt' }" class="btn-primary mt-6 w-full">
      + {{ t('hunts.new') }}
    </RouterLink>
  </main>
</template>
