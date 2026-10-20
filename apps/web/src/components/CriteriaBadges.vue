<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDistance, formatPLN, type CriteriaViolation } from '@at/shared'
import type { ListingWithPhotos } from '@/lib/listings'
import { useVotesStore } from '@/stores/votes'

// One red badge per hunt criterion the listing breaks. The violations come from
// hunt_listing_summaries (computed in SQL) unless the parent passes them.
const props = defineProps<{ listing: ListingWithPhotos; violations?: CriteriaViolation[] }>()
const { t, d } = useI18n()
const votes = useVotesStore()

const area = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 })

const list = computed(
  () => props.violations ?? votes.summaries[props.listing.id]?.criteria_violations ?? [],
)

function text(v: CriteriaViolation): string {
  switch (v.code) {
    case 'max_total':
      return t('criteria.badge.max_total', { over: formatPLN(v.actual - v.limit) })
    case 'min_rooms':
      return t('criteria.badge.min_rooms', { actual: v.actual, limit: v.limit }, v.actual)
    case 'min_area':
      return t('criteria.badge.min_area', {
        actual: area.format(v.actual),
        limit: area.format(v.limit),
      })
    case 'district':
      return t('criteria.badge.district', { actual: v.actual })
    case 'max_distance':
      return t('criteria.badge.max_distance', {
        actual: formatDistance(v.actual),
        limit: formatDistance(v.limit),
        pin: v.pin_label,
      })
    case 'available_from': {
      const date = d(new Date(v.actual), 'short')
      const early = v.from != null && v.actual < v.from
      return t(early ? 'criteria.badge.available_early' : 'criteria.badge.available_late', { date })
    }
    case 'elevator':
      return t('criteria.badge.elevator', { floor: v.floor })
    default:
      return t(`criteria.badge.${v.code}`)
  }
}
</script>

<template>
  <span
    v-for="v in list"
    :key="v.code"
    class="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800"
    data-testid="criteria-badge"
    :data-code="v.code"
  >
    {{ text(v) }}
  </span>
</template>
