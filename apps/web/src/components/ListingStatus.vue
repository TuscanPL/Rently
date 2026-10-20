<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ListingWithPhotos } from '@/lib/listings'
import { useViewingIcs } from '@/lib/useViewingIcs'
import StatusPill from './StatusPill.vue'
import StatusSheet from './StatusSheet.vue'

// The listing detail's pipeline status, with the booked viewing and its .ics.
defineProps<{ listing: ListingWithPhotos }>()
const { t, d } = useI18n()
const downloadViewing = useViewingIcs()
const open = ref(false)
</script>

<template>
  <section class="card space-y-2" data-testid="listing-status">
    <div class="flex items-center gap-3">
      <h3 class="font-semibold">{{ t('pipeline.title') }}</h3>
      <StatusPill :status="listing.status" />
      <button type="button" class="ml-auto text-sm text-brand-700" @click="open = true">
        {{ t('pipeline.change') }}
      </button>
    </div>
    <div
      v-if="listing.status === 'viewing_booked' && listing.viewing_at"
      class="flex flex-wrap items-center gap-2"
    >
      <span class="flex-1 text-sm font-medium text-violet-800" data-testid="viewing-at">
        🗓 {{ t('pipeline.viewingAt', { date: d(new Date(listing.viewing_at), 'viewing') }) }}
      </span>
      <button type="button" class="btn-secondary py-1.5" @click="downloadViewing(listing)">
        📅 {{ t('pipeline.downloadIcs') }}
      </button>
    </div>
    <StatusSheet v-if="open" :listing="listing" @close="open = false" />
  </section>
</template>
