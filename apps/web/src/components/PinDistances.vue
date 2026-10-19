<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDistance, hasCoords, type MaybeLatLng } from '@at/shared'
import { PIN_ICONS, pinDistances } from '@/lib/geo'
import { usePinsStore } from '@/stores/pins'

// Distance from a listing to the open hunt's pins. `compact` (cards) shows the
// two nearest on one line; the full version (detail) lists every pin.
const props = defineProps<{ listing: MaybeLatLng; compact?: boolean }>()
const { t } = useI18n()
const pinsStore = usePinsStore()

const located = computed(() => hasCoords(props.listing))
const distances = computed(() => {
  const all = pinDistances(props.listing, pinsStore.pins)
  return props.compact ? all.slice(0, 2) : all
})
</script>

<template>
  <p
    v-if="compact && distances.length"
    class="flex min-w-0 gap-3 text-xs text-slate-600"
    data-testid="pin-distances"
  >
    <span
      v-for="{ pin, km } in distances"
      :key="pin.id"
      class="min-w-0 truncate"
      :title="pin.label"
    >
      <span class="mr-0.5" aria-hidden="true">{{ PIN_ICONS[pin.kind] }}</span>
      <strong class="font-semibold text-slate-800">{{ formatDistance(km) }}</strong>
      {{ pin.label }}
    </span>
  </p>

  <div v-else-if="!compact" data-testid="pin-distances">
    <p v-if="!pinsStore.pins.length" class="text-sm text-slate-500">
      {{ t('distance.noPins') }}
    </p>
    <p v-else-if="!located" class="text-sm text-slate-500">{{ t('distance.noLocation') }}</p>
    <ul v-else class="divide-y divide-slate-100 text-sm">
      <li v-for="{ pin, km } in distances" :key="pin.id" class="flex items-center gap-2 py-1.5">
        <span aria-hidden="true">{{ PIN_ICONS[pin.kind] }}</span>
        <span class="min-w-0 flex-1 truncate">{{ pin.label }}</span>
        <span class="font-semibold">{{ formatDistance(km) }}</span>
      </li>
    </ul>
  </div>
</template>
