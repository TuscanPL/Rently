<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useListingsStore } from '@/stores/listings'
import { MAX_COMPARE } from '@/lib/compare'
import ListingCard from '@/components/ListingCard.vue'

// Milestone 2: newest first. Sorting and filters arrive in milestone 4.
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const listingsStore = useListingsStore()

// Compare mode: tick 2–4 cards, then open them side by side.
const selecting = ref(false)
const selected = ref<string[]>([])
const full = computed(() => selected.value.length >= MAX_COMPARE)

function toggleSelecting() {
  selecting.value = !selecting.value
  selected.value = []
}

function toggle(id: string) {
  if (selected.value.includes(id)) selected.value = selected.value.filter((s) => s !== id)
  else if (!full.value) selected.value = [...selected.value, id]
}

function compare() {
  void router.push({
    name: 'compare',
    params: { huntId: route.params.huntId },
    query: { ids: selected.value.join(',') },
  })
}
</script>

<template>
  <div class="space-y-3">
    <p v-if="listingsStore.loading" class="text-slate-500">{{ t('common.loading') }}</p>
    <div
      v-else-if="listingsStore.listings.length === 0"
      class="card mt-6 space-y-3 text-center text-slate-600"
    >
      <p class="text-4xl">🏠</p>
      <p>{{ t('list.empty') }}</p>
      <RouterLink
        :to="{ name: 'add', params: { huntId: route.params.huntId } }"
        class="btn-primary"
      >
        {{ t('add.title') }}
      </RouterLink>
    </div>

    <template v-if="listingsStore.listings.length >= 2">
      <div
        v-if="selecting"
        class="sticky top-[calc(2.6rem+max(0.75rem,env(safe-area-inset-top)))] z-[5] -mx-4 flex items-center gap-3 border-b border-slate-200 bg-slate-50/95 px-4 py-2 backdrop-blur"
        data-testid="compare-bar"
      >
        <span class="flex-1 text-sm text-slate-600">{{ t('compare.selectHint') }}</span>
        <button type="button" class="btn-secondary py-1.5" @click="toggleSelecting">
          {{ t('common.cancel') }}
        </button>
        <button
          type="button"
          class="btn-primary py-1.5"
          :disabled="selected.length < 2"
          @click="compare"
        >
          {{ t('compare.button', { n: selected.length }) }}
        </button>
      </div>
      <div v-else class="flex justify-end">
        <button type="button" class="btn-secondary py-1.5" @click="toggleSelecting">
          ⇆ {{ t('compare.start') }}
        </button>
      </div>
    </template>

    <div v-for="l in listingsStore.listings" :key="l.id" class="relative">
      <ListingCard
        :listing="l"
        :class="
          selecting && selected.includes(l.id) ? 'border-brand-600 ring-2 ring-brand-600' : ''
        "
      />
      <label
        v-if="selecting"
        class="absolute inset-0 flex cursor-pointer items-start rounded-2xl p-2"
        :class="{ 'cursor-not-allowed': full && !selected.includes(l.id) }"
      >
        <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-white/90 shadow">
          <input
            type="checkbox"
            class="h-5 w-5 accent-brand-700"
            :checked="selected.includes(l.id)"
            :disabled="full && !selected.includes(l.id)"
            :aria-label="t('compare.select', { title: l.title ?? t('listing.untitled') })"
            data-testid="compare-checkbox"
            @change="toggle(l.id)"
          />
        </span>
      </label>
    </div>
  </div>
</template>
