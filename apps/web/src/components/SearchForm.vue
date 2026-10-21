<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  OTODOM_CITIES,
  buildOtodomSearchUrl,
  isOtodomSearchUrl,
  otodomCityFor,
  withNewestFirst,
  type OtodomSearchParams,
} from '@at/parsers'
import { formatPLN, type HuntCriteria } from '@at/shared'
import type { SavedSearch } from '@/lib/browse'

// Set up an Otodom search to browse: build it from a few filters (the app
// writes the Otodom link), or paste a results link from otodom.pl.

const props = defineProps<{
  search: SavedSearch | null
  huntCity: string | null
  criteria: HuntCriteria
  saving: boolean
  /** Show Cancel for a new search too (when another search already exists). */
  cancellable?: boolean
}>()
const emit = defineEmits<{
  save: [fields: { label: string; url: string; params: OtodomSearchParams | null }]
  cancel: []
  remove: []
}>()
const { t } = useI18n()

const editing = computed(() => !!props.search)
const saved = props.search?.params as OtodomSearchParams | null | undefined
const mode = ref<'build' | 'paste'>(props.search && !saved ? 'paste' : 'build')
const label = ref(props.search?.label ?? '')
const pasted = ref(props.search && !saved ? props.search.url : '')
const params = ref<OtodomSearchParams>(
  saved ?? {
    city: otodomCityFor(props.huntCity) ?? 'warszawa',
    district: null,
    priceMax: null,
    roomsMin: null,
    roomsMax: null,
    areaMin: null,
    privateOnly: false,
  },
)

const districts = computed(() => Object.entries(OTODOM_CITIES[params.value.city]?.districts ?? {}))
const builtUrl = computed(() => buildOtodomSearchUrl(params.value))
const pastedValid = computed(() => isOtodomSearchUrl(pasted.value.trim()))
const canSave = computed(() => (mode.value === 'build' ? true : pastedValid.value))
const hasCriteria = computed(
  () =>
    props.criteria.maxTotalMonthly != null ||
    props.criteria.minRooms != null ||
    props.criteria.minAreaM2 != null ||
    props.criteria.privateOnly != null,
)

function num(v: string): number | null {
  const n = Number(v)
  return v.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null
}

/** Fills the filters from the hunt's criteria. Otodom filters on rent without czynsz. */
function useCriteria() {
  const c = props.criteria
  params.value = {
    ...params.value,
    priceMax: c.maxTotalMonthly ?? params.value.priceMax,
    roomsMin: c.minRooms ?? params.value.roomsMin,
    areaMin: c.minAreaM2 ?? params.value.areaMin,
    privateOnly: c.privateOnly ?? params.value.privateOnly,
  }
}

/** "Mokotów · 3+ rooms · up to 5 000 zł", used when no name is given. */
function summary(p: OtodomSearchParams): string {
  const city = OTODOM_CITIES[p.city]
  const parts = [p.district ? (city?.districts[p.district] ?? city?.label) : city?.label]
  if (p.roomsMin || p.roomsMax) {
    parts.push(
      p.roomsMax && p.roomsMin !== p.roomsMax
        ? t('searchForm.roomsRange', { from: p.roomsMin ?? 1, to: p.roomsMax })
        : p.roomsMax && p.roomsMin === p.roomsMax
          ? t('listing.roomsShort', p.roomsMax)
          : t('searchForm.roomsFrom', { n: p.roomsMin }),
    )
  }
  if (p.priceMax) parts.push(t('searchForm.upTo', { price: formatPLN(p.priceMax) }))
  if (p.privateOnly) parts.push(t('searchForm.private'))
  return parts.filter(Boolean).join(' · ')
}

function submit() {
  if (mode.value === 'build') {
    emit('save', {
      label: label.value.trim() || summary(params.value),
      url: builtUrl.value,
      params: { ...params.value },
    })
  } else {
    emit('save', {
      label: label.value.trim() || t('browse.defaultLabel'),
      url: withNewestFirst(pasted.value.trim()),
      params: null,
    })
  }
}
</script>

<template>
  <form class="card space-y-4" data-testid="search-form" @submit.prevent="submit">
    <h2 class="font-semibold">
      {{ editing ? t('browse.editTitle') : t('browse.setupTitle') }}
    </h2>

    <div class="grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-semibold" role="tablist">
      <button
        v-for="m in ['build', 'paste'] as const"
        :key="m"
        type="button"
        role="tab"
        :aria-selected="mode === m"
        class="rounded-lg py-2"
        :class="mode === m ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600'"
        @click="mode = m"
      >
        {{ t(`searchForm.mode.${m}`) }}
      </button>
    </div>

    <template v-if="mode === 'build'">
      <button
        v-if="hasCriteria"
        type="button"
        class="btn-secondary w-full"
        data-testid="use-criteria"
        @click="useCriteria"
      >
        {{ t('searchForm.useCriteria') }}
      </button>
      <div>
        <label class="label" for="sf-city">{{ t('searchForm.city') }}</label>
        <select id="sf-city" v-model="params.city" class="input" @change="params.district = null">
          <option v-for="(c, key) in OTODOM_CITIES" :key="key" :value="key">{{ c.label }}</option>
        </select>
      </div>
      <div v-if="districts.length">
        <label class="label" for="sf-district">{{ t('searchForm.district') }}</label>
        <select id="sf-district" v-model="params.district" class="input">
          <option :value="null">{{ t('searchForm.wholeCity') }}</option>
          <option v-for="[key, name] in districts" :key="key" :value="key">{{ name }}</option>
        </select>
      </div>
      <div>
        <label class="label" for="sf-price">{{ t('searchForm.priceMax') }}</label>
        <input
          id="sf-price"
          :value="params.priceMax ?? ''"
          type="number"
          min="0"
          step="100"
          inputmode="numeric"
          class="input"
          @input="params.priceMax = num(($event.target as HTMLInputElement).value)"
        />
        <p class="mt-1 text-xs text-slate-500">{{ t('searchForm.priceHelp') }}</p>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="label" for="sf-rooms-min">{{ t('searchForm.roomsMin') }}</label>
          <input
            id="sf-rooms-min"
            :value="params.roomsMin ?? ''"
            type="number"
            min="1"
            max="10"
            inputmode="numeric"
            class="input"
            @input="params.roomsMin = num(($event.target as HTMLInputElement).value)"
          />
        </div>
        <div>
          <label class="label" for="sf-rooms-max">{{ t('searchForm.roomsMax') }}</label>
          <input
            id="sf-rooms-max"
            :value="params.roomsMax ?? ''"
            type="number"
            min="1"
            max="10"
            inputmode="numeric"
            class="input"
            @input="params.roomsMax = num(($event.target as HTMLInputElement).value)"
          />
        </div>
      </div>
      <div>
        <label class="label" for="sf-area">{{ t('searchForm.areaMin') }}</label>
        <input
          id="sf-area"
          :value="params.areaMin ?? ''"
          type="number"
          min="0"
          inputmode="numeric"
          class="input"
          @input="params.areaMin = num(($event.target as HTMLInputElement).value)"
        />
      </div>
      <label class="flex items-center gap-3 text-sm">
        <input v-model="params.privateOnly" type="checkbox" class="h-5 w-5 accent-brand-700" />
        {{ t('searchForm.privateOnly') }}
      </label>
      <a
        :href="builtUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="block text-sm font-semibold text-brand-700"
        data-testid="built-url"
      >
        {{ t('searchForm.checkOnOtodom') }} ↗
      </a>
    </template>

    <template v-else>
      <ol class="list-decimal space-y-1 pl-5 text-sm text-slate-600">
        <li>{{ t('browse.step1') }}</li>
        <li>{{ t('browse.step2') }}</li>
      </ol>
      <div>
        <label class="label" for="search-url">{{ t('browse.url') }}</label>
        <input
          id="search-url"
          v-model="pasted"
          type="url"
          inputmode="url"
          class="input"
          placeholder="https://www.otodom.pl/pl/wyniki/wynajem/mieszkanie/…"
        />
        <p v-if="pasted && !pastedValid" class="mt-1 text-xs text-rose-700">
          {{ t('browse.urlInvalid') }}
        </p>
      </div>
    </template>

    <div>
      <label class="label" for="search-label">{{ t('browse.label') }}</label>
      <input
        id="search-label"
        v-model="label"
        maxlength="80"
        class="input"
        :placeholder="mode === 'build' ? summary(params) : t('browse.defaultLabel')"
      />
    </div>

    <div class="flex flex-wrap gap-3">
      <button
        v-if="editing || cancellable"
        type="button"
        class="btn-secondary"
        @click="emit('cancel')"
      >
        {{ t('common.cancel') }}
      </button>
      <button v-if="editing" type="button" class="btn-danger" @click="emit('remove')">
        {{ t('browse.delete') }}
      </button>
      <button type="submit" class="btn-primary flex-1" :disabled="saving || !canSave">
        {{ saving ? t('common.saving') : editing ? t('browse.save') : t('searchForm.search') }}
      </button>
    </div>
  </form>
</template>
