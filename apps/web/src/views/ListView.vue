<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { LISTING_STATUSES, type HuntCriteria, type ListingStatus } from '@at/shared'
import { useHuntsStore } from '@/stores/hunts'
import { useListingsStore } from '@/stores/listings'
import { usePinsStore } from '@/stores/pins'
import { useVotesStore } from '@/stores/votes'
import { MAX_COMPARE } from '@/lib/compare'
import { PIN_ICONS } from '@/lib/geo'
import { STATUS_CLASSES } from '@/lib/pipeline'
import { SWIPE_ICONS } from '@/lib/votes'
import {
  activeFilterCount,
  applyListPrefs,
  defaultListPrefs,
  loadListPrefs,
  saveListPrefs,
  SORT_KEYS,
  sortPin,
  VOTE_FILTERS,
  type ListPrefs,
} from '@/lib/listFilters'
import ListingCard from '@/components/ListingCard.vue'

// Every listing in the hunt, sorted and filtered. The choice is remembered per
// hunt on this device. Cards stack on a phone and form a grid on wider screens.
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const huntsStore = useHuntsStore()
const listingsStore = useListingsStore()
const pinsStore = usePinsStore()
const votes = useVotesStore()

const huntId = computed(() => route.params.huntId as string)
const prefs = ref<ListPrefs>(loadListPrefs(huntId.value))
const showFilters = ref(false)
watch(huntId, (id) => (prefs.value = loadListPrefs(id)))
watch(prefs, (p) => saveListPrefs(huntId.value, p), { deep: true })

const criteriaPinId = computed<string | null>(() => {
  // Read through `unknown`: Pinia's unwrapped Json type is too deep for TS (TS2589).
  const hunt = huntsStore.current as { criteria?: unknown } | null
  const criteria = hunt?.criteria as HuntCriteria | null | undefined
  return criteria?.distancePinId ?? null
})
const pin = computed(() => sortPin(prefs.value, pinsStore.pins, criteriaPinId.value))
const shown = computed(() =>
  applyListPrefs(listingsStore.listings, prefs.value, {
    summaries: votes.summaries,
    pin: prefs.value.sort === 'distance' ? pin.value : null,
  }),
)
const filterCount = computed(() => activeFilterCount(prefs.value))

function toggleStatus(s: ListingStatus) {
  const list = prefs.value.statuses
  prefs.value.statuses = list.includes(s) ? list.filter((x) => x !== s) : [...list, s]
}

function resetFilters() {
  prefs.value = { ...defaultListPrefs(), sort: prefs.value.sort, pinId: prefs.value.pinId }
}

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

    <template v-else>
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

      <div v-else class="flex flex-wrap items-center gap-2" data-testid="list-toolbar">
        <label class="sr-only" for="list-sort">{{ t('listFilters.sort') }}</label>
        <select
          id="list-sort"
          v-model="prefs.sort"
          class="input w-auto min-w-0 flex-1 py-1.5 pr-8 text-sm sm:flex-none"
          data-testid="list-sort"
        >
          <option v-for="key in SORT_KEYS" :key="key" :value="key">
            ↕ {{ t(`listFilters.sortBy.${key}`) }}
          </option>
        </select>
        <template v-if="prefs.sort === 'distance' && pinsStore.pins.length">
          <label class="sr-only" for="list-pin">{{ t('listFilters.pin') }}</label>
          <select
            id="list-pin"
            :value="pin?.id"
            class="input w-auto max-w-44 py-1.5 pr-8 text-sm"
            @change="prefs.pinId = ($event.target as HTMLSelectElement).value"
          >
            <option v-for="p in pinsStore.pins" :key="p.id" :value="p.id">
              {{ PIN_ICONS[p.kind] }} {{ p.label }}
            </option>
          </select>
        </template>
        <button
          type="button"
          class="btn-secondary py-1.5"
          :class="{ 'border-brand-600 text-brand-800': filterCount }"
          :aria-expanded="showFilters"
          aria-controls="list-filters"
          @click="showFilters = !showFilters"
        >
          {{
            filterCount
              ? t('listFilters.filtersActive', { n: filterCount })
              : t('listFilters.filters')
          }}
        </button>
        <button
          v-if="listingsStore.listings.length >= 2"
          type="button"
          class="btn-secondary py-1.5"
          @click="toggleSelecting"
        >
          ⇆ {{ t('compare.start') }}
        </button>
      </div>

      <div
        v-if="showFilters && !selecting"
        id="list-filters"
        class="card space-y-4"
        data-testid="list-filters"
      >
        <fieldset>
          <legend class="label">{{ t('listFilters.status') }}</legend>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="s in LISTING_STATUSES"
              :key="s"
              type="button"
              class="rounded-full border px-3 py-1 text-sm"
              :class="
                prefs.statuses.includes(s)
                  ? [STATUS_CLASSES[s], 'border-transparent font-semibold ring-2 ring-brand-600']
                  : 'border-slate-200 bg-white text-slate-600'
              "
              :aria-pressed="prefs.statuses.includes(s)"
              @click="toggleStatus(s)"
            >
              {{ t(`pipeline.status.${s}`) }}
            </button>
          </div>
        </fieldset>
        <fieldset>
          <legend class="label">{{ t('listFilters.myVote') }}</legend>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="v in VOTE_FILTERS"
              :key="v"
              type="button"
              class="rounded-full border px-3 py-1 text-sm"
              :class="
                prefs.myVote === v
                  ? 'border-brand-600 bg-brand-50 font-semibold text-brand-800'
                  : 'border-slate-200 bg-white text-slate-600'
              "
              :aria-pressed="prefs.myVote === v"
              @click="prefs.myVote = v"
            >
              {{ t(`listFilters.vote.${v}`) }}
            </button>
          </div>
        </fieldset>
        <fieldset class="grid gap-2 sm:grid-cols-2">
          <legend class="label">{{ t('listFilters.show') }}</legend>
          <label
            v-for="key in ['matchesOnly', 'hideViolators', 'hideInactive', 'needsDetails'] as const"
            :key="key"
            class="flex items-center gap-3 text-sm"
          >
            <input v-model="prefs[key]" type="checkbox" class="h-5 w-5 accent-brand-700" />
            {{ t(`listFilters.${key}`) }}
          </label>
        </fieldset>
        <div class="flex gap-3">
          <button
            type="button"
            class="btn-secondary"
            :disabled="!filterCount"
            @click="resetFilters"
          >
            {{ t('listFilters.reset') }}
          </button>
          <button type="button" class="btn-primary flex-1" @click="showFilters = false">
            {{ t('listFilters.done') }}
          </button>
        </div>
      </div>

      <p v-if="filterCount && !selecting" class="text-sm text-slate-500" data-testid="list-count">
        {{ t('list.count', { shown: shown.length, total: listingsStore.listings.length }) }}
      </p>
      <p v-if="!shown.length" class="card text-center text-slate-600" data-testid="no-results">
        {{ t('list.noResults') }}
      </p>

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="listing-grid">
        <div v-for="l in shown" :key="l.id" class="relative">
          <ListingCard
            :listing="l"
            class="h-full"
            :class="
              selecting && selected.includes(l.id) ? 'border-brand-600 ring-2 ring-brand-600' : ''
            "
          >
            <p
              v-if="votes.summaries[l.id]"
              class="mt-1 flex flex-wrap items-center gap-1.5 text-xs empty:hidden"
            >
              <span
                v-if="votes.summaries[l.id]!.is_match"
                class="rounded-full bg-violet-100 px-2 py-0.5 font-semibold text-violet-800"
              >
                🏠 {{ t('map.legend.match') }}
              </span>
              <span v-if="votes.summaries[l.id]!.my_swipe" class="text-slate-500">
                {{ t('votes.mine') }}: {{ SWIPE_ICONS[votes.summaries[l.id]!.my_swipe!] }}
              </span>
            </p>
          </ListingCard>
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
  </div>
</template>
