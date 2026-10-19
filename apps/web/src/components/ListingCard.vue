<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { formatArea, formatPLN } from '@at/shared'
import { listingTotal, sortedPhotos, type ListingWithPhotos } from '@/lib/listings'
import ListingImage from './ListingImage.vue'

const props = defineProps<{ listing: ListingWithPhotos }>()
const { t } = useI18n()
const photos = computed(() => sortedPhotos(props.listing.listing_photos))
const cover = computed(() => photos.value.find((p) => p.is_cover) ?? null)
</script>

<template>
  <RouterLink
    :to="{ name: 'listing', params: { huntId: listing.hunt_id, listingId: listing.id } }"
    class="flex gap-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm hover:border-brand-500"
    data-testid="listing-card"
  >
    <div class="relative h-28 w-32 shrink-0">
      <ListingImage :photo="photos[0]" :cover="cover" />
      <span
        v-if="!listing.is_active"
        class="absolute inset-x-0 bottom-0 bg-slate-900/70 px-1 py-0.5 text-center text-xs text-white"
      >
        {{ t('listing.adRemoved') }}
      </span>
    </div>
    <div class="min-w-0 flex-1 py-2 pr-3">
      <p class="truncate font-semibold">{{ listing.title ?? t('listing.untitled') }}</p>
      <p class="text-lg font-bold text-brand-800">{{ formatPLN(listingTotal(listing)) }}</p>
      <p class="truncate text-sm text-slate-600">
        {{ formatArea(listing.area_m2) }} ·
        {{ listing.rooms ? t('listing.roomsShort', listing.rooms) : '—' }}
        <template v-if="listing.district"> · {{ listing.district }}</template>
      </p>
      <span
        v-if="listing.needs_details"
        class="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
      >
        {{ t('listing.needsDetails') }}
      </span>
      <!-- Extra badges from the parent (score, vote state…). Keep it non-interactive: the card is a link. -->
      <slot />
    </div>
  </RouterLink>
</template>
