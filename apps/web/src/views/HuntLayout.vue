<script setup lang="ts">
import { ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useHuntsStore } from '@/stores/hunts'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const huntsStore = useHuntsStore()
const error = ref<string | null>(null)

const tabs = [
  { name: 'deck', icon: '🃏' },
  { name: 'list', icon: '☰' },
  { name: 'map', icon: '🗺️' },
  { name: 'pipeline', icon: '📋' },
  { name: 'settings', icon: '⚙️' },
] as const

watch(
  () => route.params.huntId as string,
  async (id) => {
    if (!id) return
    error.value = null
    try {
      const hunt = await huntsStore.openHunt(id)
      // Not a member (or the hunt is gone): back to the list.
      if (!hunt) await router.replace({ name: 'hunts' })
    } catch (e) {
      error.value = (e as Error).message
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <header
      class="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur"
    >
      <RouterLink :to="{ name: 'hunts' }" class="text-brand-700" :aria-label="t('nav.allHunts')"
        >‹</RouterLink
      >
      <h1 class="truncate text-lg font-semibold">{{ huntsStore.current?.name ?? '…' }}</h1>
    </header>

    <main class="mx-auto w-full max-w-3xl flex-1 px-4 py-4 pb-24 md:pb-6">
      <p v-if="error" class="text-rose-700">{{ t('common.error', { message: error }) }}</p>
      <RouterView v-else-if="huntsStore.current" />
      <p v-else class="text-slate-500">{{ t('common.loading') }}</p>
    </main>

    <nav
      class="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:static md:order-first md:border-t-0 md:border-b"
    >
      <ul class="mx-auto flex max-w-3xl">
        <li v-for="tab in tabs" :key="tab.name" class="flex-1">
          <RouterLink
            :to="{ name: tab.name, params: { huntId: route.params.huntId } }"
            class="flex flex-col items-center gap-0.5 py-2 text-xs text-slate-500"
            active-class="!text-brand-700 font-semibold"
          >
            <span class="text-lg" aria-hidden="true">{{ tab.icon }}</span>
            {{ t(`nav.${tab.name}`) }}
          </RouterLink>
        </li>
      </ul>
    </nav>
  </div>
</template>
