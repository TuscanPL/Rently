<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatPLN } from '@at/shared'
import { usePriceChangesStore } from '@/stores/priceChanges'

// "Price dropped 200 zł" (green) or "Price up 150 zł" (amber) when the listing's
// price changed in the last two weeks; nothing otherwise.
const props = defineProps<{ huntId: string; listingId: string }>()
const { t } = useI18n()
const store = usePriceChangesStore()
store.open(props.huntId)

const change = computed(() => store.byListing[props.listingId] ?? null)
</script>

<template>
  <span
    v-if="change"
    class="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
    :class="change.delta < 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'"
    data-testid="price-change"
  >
    {{
      t(change.delta < 0 ? 'upkeep.priceDropped' : 'upkeep.priceUp', {
        amount: formatPLN(Math.abs(change.delta)),
      })
    }}
  </span>
</template>
