<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useHuntsStore } from '@/stores/hunts'
import { readShared } from '@/lib/share'
import { LAST_HUNT_KEY, readLocal } from '@/lib/storage'

// Where the share sheet lands (#/add?url=…): pick the hunt, then continue in
// that hunt's add flow with the link (or the shared text) filled in.
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const huntsStore = useHuntsStore()

const param = (k: string) => (typeof route.query[k] === 'string' ? (route.query[k] as string) : '')
const shared = readShared({ url: param('url'), text: param('text'), title: param('title') })

const loading = ref(true)
const error = ref<string | null>(null)
const huntId = ref<string | null>(null)

function proceed(id: string) {
  const query = shared.url ? { url: shared.url } : shared.text ? { text: shared.text } : {}
  return router.replace({ name: 'add', params: { huntId: id }, query })
}

onMounted(async () => {
  try {
    await huntsStore.fetchHunts()
    const ids = (huntsStore.hunts as { id: string }[]).map((h) => h.id)
    if (ids.length === 1) {
      await proceed(ids[0]!)
      return
    }
    // Preselect the hunt opened last.
    const last = readLocal(LAST_HUNT_KEY)
    huntId.value = last && ids.includes(last) ? last : (ids[0] ?? null)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <main class="mx-auto max-w-lg px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-10">
    <RouterLink :to="{ name: 'hunts' }" class="text-sm text-brand-700"
      >‹ {{ t('nav.allHunts') }}</RouterLink
    >
    <h1 class="mt-2 mb-4 text-2xl font-bold">{{ t('share.title') }}</h1>

    <div class="card mb-6 text-sm" data-testid="shared-preview">
      <p class="mb-1 font-medium text-slate-500">{{ t('share.shared') }}</p>
      <p v-if="shared.url" class="break-all text-brand-800">{{ shared.url }}</p>
      <p v-else-if="shared.text" class="line-clamp-4 whitespace-pre-line text-slate-700">
        {{ shared.text }}
      </p>
      <p v-else class="text-slate-500">{{ t('share.nothing') }}</p>
    </div>

    <p v-if="loading" class="text-slate-500">{{ t('common.loading') }}</p>
    <p v-else-if="error" class="text-rose-700" role="alert">
      {{ t('common.error', { message: error }) }}
    </p>
    <template v-else-if="huntsStore.hunts.length === 0">
      <p class="card mb-4 text-slate-600">{{ t('share.noHunts') }}</p>
      <RouterLink :to="{ name: 'new-hunt' }" class="btn-primary w-full">
        + {{ t('hunts.new') }}
      </RouterLink>
    </template>
    <form v-else @submit.prevent="huntId && proceed(huntId)">
      <fieldset>
        <legend class="label mb-2">{{ t('share.pickHunt') }}</legend>
        <div class="space-y-2">
          <label
            v-for="hunt in huntsStore.hunts"
            :key="hunt.id"
            class="card flex cursor-pointer items-center gap-3 py-3"
            :class="{ 'border-brand-600 ring-2 ring-brand-100': huntId === hunt.id }"
          >
            <input
              v-model="huntId"
              type="radio"
              name="hunt"
              :value="hunt.id"
              class="h-4 w-4 accent-brand-700"
            />
            <span class="min-w-0">
              <span class="block truncate font-semibold">{{ hunt.name }}</span>
              <span class="text-sm text-slate-500">{{ hunt.city }}</span>
            </span>
          </label>
        </div>
      </fieldset>
      <button type="submit" class="btn-primary mt-6 w-full py-3 text-base" :disabled="!huntId">
        {{ t('share.continue') }}
      </button>
    </form>
  </main>
</template>
