<script setup lang="ts">
import type { ListingWithPhotos } from '@/lib/listings'

// Milestone 5 (map & pins) plugs in here: the listing's distance to each hunt pin.
// Used on the swipe card; renders nothing until then.
defineProps<{ listing: ListingWithPhotos }>()
</script>

<template>
  <template v-if="false"></template>
</template>
