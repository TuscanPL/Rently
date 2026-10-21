<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDistance, hasCoords, type MaybeLatLng } from '@at/shared'
import { PIN_ICONS, pinDistances, type Pin } from '@/lib/geo'
import { arrivalLabel, legSummary } from '@/lib/transit'
import { usePinsStore } from '@/stores/pins'
import { useRoutesStore } from '@/stores/routes'

// Distance and public transport time from a listing to the open hunt's pins.
// `compact` (cards) shows the two nearest on one line; the full version
// (detail) lists every pin with the trip's legs.
const props = defineProps<{ listing: MaybeLatLng & { id?: string }; compact?: boolean }>()
const { t } = useI18n()
const pinsStore = usePinsStore()
const routesStore = useRoutesStore()

const located = computed(() => hasCoords(props.listing))
const distances = computed(() => {
  const all = pinDistances(props.listing, pinsStore.pins)
  return props.compact ? all.slice(0, 2) : all
})

function route(pin: Pin) {
  return props.listing.id ? routesStore.get(props.listing.id, pin.id) : undefined
}
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
      <template v-if="route(pin)?.status === 'ok'">
        ·
        <strong class="font-semibold text-slate-800" data-testid="transit-minutes"
          >🚆 {{ t('transit.minutes', { n: route(pin)!.duration_min }) }}</strong
        >
      </template>
      {{ pin.label }}
    </span>
  </p>

  <div v-else-if="!compact" data-testid="pin-distances">
    <p v-if="!pinsStore.pins.length" class="text-sm text-slate-500">
      {{ t('distance.noPins') }}
    </p>
    <p v-else-if="!located" class="text-sm text-slate-500">{{ t('distance.noLocation') }}</p>
    <ul v-else class="divide-y divide-slate-100 text-sm">
      <li v-for="{ pin, km } in distances" :key="pin.id" class="py-2" data-testid="pin-trip">
        <div class="flex items-center gap-2">
          <span aria-hidden="true">{{ PIN_ICONS[pin.kind] }}</span>
          <span class="min-w-0 flex-1 truncate">{{ pin.label }}</span>
          <span class="font-semibold">{{ formatDistance(km) }}</span>
        </div>
        <div class="mt-0.5 pl-6 text-xs text-slate-600">
          <template v-if="route(pin)?.status === 'ok'">
            <p>
              <strong class="text-sm text-slate-900"
                >🚆 {{ t('transit.minutes', { n: route(pin)!.duration_min }) }}</strong
              >
              ·
              {{
                route(pin)!.transfers
                  ? t('transit.transfers', route(pin)!.transfers!)
                  : t('transit.direct')
              }}
              ·
              {{
                t('transit.arriveBy', { when: arrivalLabel(pin.arrive_weekday, pin.arrive_time) })
              }}
            </p>
            <p class="mt-0.5 truncate" data-testid="transit-legs">{{ legSummary(route(pin)!) }}</p>
          </template>
          <p v-else-if="route(pin)?.status === 'no_route'">{{ t('transit.noRoute') }}</p>
          <p v-else-if="route(pin)?.status === 'error'">{{ t('transit.failed') }}</p>
          <p v-else-if="listing.id">{{ t('transit.lookingUp') }}</p>
        </div>
      </li>
    </ul>
    <p v-if="located && pinsStore.pins.length" class="mt-1 text-[11px] text-slate-400">
      {{ t('transit.credit') }}
      <a href="https://transitous.org" target="_blank" rel="noopener" class="underline"
        >Transitous</a
      >
    </p>
  </div>
</template>
