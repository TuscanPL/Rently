<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  costPerM2,
  distanceBetween,
  formatArea,
  formatDistance,
  formatPLN,
  type ListingFeatures,
} from '@at/shared'
import { bestIndexes, parseCompareIds, type Better } from '@/lib/compare'
import { PIN_ICONS } from '@/lib/geo'
import { listingTotal, sortedPhotos, type ListingWithPhotos } from '@/lib/listings'
import { useListingsStore } from '@/stores/listings'
import { usePinsStore } from '@/stores/pins'
import { useRoutesStore } from '@/stores/routes'
import ListingImage from '@/components/ListingImage.vue'

const { t, d } = useI18n()
const route = useRoute()
const router = useRouter()
const listingsStore = useListingsStore()
const pinsStore = usePinsStore()
const routesStore = useRoutesStore()
const huntId = route.params.huntId as string

const ids = computed(() => parseCompareIds(route.query.ids))
const listings = computed(() =>
  ids.value.flatMap((id) => listingsStore.listings.find((l) => l.id === id) ?? []),
)

interface Row {
  key: string
  label: string
  icon?: string
  cells: string[]
  /** Columns to highlight as the best value. */
  best: number[]
}

function numericRow(
  key: string,
  label: string,
  value: (l: ListingWithPhotos) => number | null,
  format: (v: number | null) => string,
  better: Better | null,
  icon?: string,
): Row {
  const values = listings.value.map(value)
  return {
    key,
    label,
    icon,
    cells: values.map(format),
    best: better ? bestIndexes(values, better) : [],
  }
}

function textRow(key: string, label: string, value: (l: ListingWithPhotos) => string): Row {
  return { key, label, cells: listings.value.map(value), best: [] }
}

const plain = (v: number | null) => (v == null ? '—' : String(v))
const FEATURE_KEYS = ['balcony', 'elevator', 'parking', 'petsAllowed', 'furnished'] as const

const rows = computed<Row[]>(() => [
  numericRow('total', t('compare.total'), listingTotal, formatPLN, 'min'),
  numericRow('rent', t('form.rent'), (l) => l.rent, formatPLN, 'min'),
  numericRow('adminFee', t('form.adminFee'), (l) => l.admin_fee, formatPLN, 'min'),
  numericRow(
    'utilities',
    t('form.utilitiesEstimate'),
    (l) => l.utilities_estimate,
    formatPLN,
    'min',
  ),
  numericRow('deposit', t('form.deposit'), (l) => l.deposit, formatPLN, 'min'),
  numericRow('area', t('compare.area'), (l) => l.area_m2, formatArea, 'max'),
  numericRow(
    'perM2',
    t('listing.perM2'),
    (l) =>
      costPerM2({
        rent: l.rent,
        adminFee: l.admin_fee,
        utilitiesEstimate: l.utilities_estimate,
        areaM2: l.area_m2,
      }),
    formatPLN,
    'min',
  ),
  numericRow('rooms', t('form.rooms'), (l) => l.rooms, plain, 'max'),
  textRow('floor', t('form.floor'), (l) =>
    l.floor == null
      ? '—'
      : l.total_floors != null
        ? `${l.floor} / ${l.total_floors}`
        : `${l.floor}`,
  ),
  textRow('district', t('form.district'), (l) => l.district ?? '—'),
  ...pinsStore.pins.map((pin) =>
    numericRow(
      `pin-${pin.id}`,
      pin.label,
      (l) => distanceBetween(l, pin),
      formatDistance,
      'min',
      PIN_ICONS[pin.kind],
    ),
  ),
  ...pinsStore.pins.map((pin) =>
    numericRow(
      `transit-${pin.id}`,
      t('transit.compareRow', { label: pin.label }),
      (l) => {
        const route = routesStore.get(l.id, pin.id)
        return route?.status === 'ok' ? route.duration_min : null
      },
      (n) => (n == null ? '—' : t('transit.minutes', { n })),
      'min',
      '🚆',
    ),
  ),
  textRow('availableFrom', t('form.availableFrom'), (l) =>
    l.available_from ? d(new Date(l.available_from), 'short') : '—',
  ),
  textRow('advertiser', t('form.advertiserType'), (l) =>
    l.advertiser_type === 'unknown' ? '—' : t(`form.${l.advertiser_type}`),
  ),
  textRow('features', t('compare.features'), (l) => {
    const f = (l.features ?? {}) as ListingFeatures
    const yes = FEATURE_KEYS.filter((k) => f[k]).map((k) => t(`features.${k}`))
    return yes.join(', ') || '—'
  }),
])

function removeColumn(id: string) {
  void router.replace({
    query: { ...route.query, ids: ids.value.filter((i) => i !== id).join(',') },
  })
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-3">
      <h2 class="text-xl font-bold">{{ t('compare.title') }}</h2>
      <RouterLink :to="{ name: 'list', params: { huntId } }" class="text-sm text-brand-700">
        ‹ {{ t('compare.backToList') }}
      </RouterLink>
    </div>

    <p v-if="listingsStore.loading" class="text-slate-500">{{ t('common.loading') }}</p>
    <div v-else-if="listings.length < 2" class="card space-y-3 text-center text-slate-600">
      <p>{{ t('compare.needTwo') }}</p>
      <RouterLink :to="{ name: 'list', params: { huntId } }" class="btn-primary">
        {{ t('compare.pick') }}
      </RouterLink>
    </div>

    <div v-else class="-mx-4 overflow-x-auto pb-2">
      <table
        class="w-max min-w-full border-separate border-spacing-0 text-sm"
        data-testid="compare-table"
      >
        <thead>
          <tr>
            <th class="sticky left-0 z-10 w-28 min-w-28 bg-slate-50" />
            <th
              v-for="l in listings"
              :key="l.id"
              class="w-36 min-w-36 px-2 pb-2 text-left align-top font-normal"
            >
              <div class="relative h-24 overflow-hidden rounded-xl">
                <ListingImage
                  :photo="sortedPhotos(l.listing_photos)[0]"
                  :cover="l.listing_photos.find((p) => p.is_cover) ?? null"
                />
                <button
                  v-if="listings.length > 2"
                  type="button"
                  class="absolute top-1 right-1 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-slate-600 shadow"
                  :aria-label="t('compare.remove')"
                  @click="removeColumn(l.id)"
                >
                  ×
                </button>
              </div>
              <RouterLink
                :to="{ name: 'listing', params: { huntId, listingId: l.id } }"
                class="mt-1 line-clamp-2 font-semibold text-brand-800 hover:underline"
              >
                {{ l.title ?? t('listing.untitled') }}
              </RouterLink>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.key" :data-row="row.key">
            <th
              scope="row"
              class="sticky left-0 z-10 border-t border-slate-200 bg-slate-50 px-3 py-2 text-left align-top text-xs font-medium text-slate-600"
            >
              <span v-if="row.icon" class="mr-1" aria-hidden="true">{{ row.icon }}</span
              >{{ row.label }}
            </th>
            <td
              v-for="(cell, i) in row.cells"
              :key="i"
              class="border-t border-slate-200 px-3 py-2 align-top"
              :class="
                row.best.includes(i) ? 'bg-emerald-50 font-semibold text-emerald-800' : 'bg-white'
              "
              :data-best="row.best.includes(i) ? 'true' : undefined"
            >
              {{ cell }}
              <span v-if="row.best.includes(i)" class="sr-only">({{ t('compare.best') }})</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
