<script setup lang="ts">
import type { ListingWithPhotos } from '@/lib/listings'

// Milestone 4 (hunt criteria) plugs in here: one red badge per criterion the
// listing breaks, e.g. from hunt_listing_summaries.criteria_violations.
// Used on the swipe card; renders nothing until then.
defineProps<{ listing: ListingWithPhotos; violations?: unknown[] }>()
</script>

<template>
  <template v-if="false"></template>
</template>
