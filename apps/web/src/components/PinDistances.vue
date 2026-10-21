<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { formatDistance, hasCoords, type MaybeLatLng } from '@at/shared'
import { PIN_ICONS, pinDistances, type Pin } from '@/lib/geo'
import { arrivalLabel, modeIcon, routeLegs, type RouteLeg } from '@/lib/transit'
import { usePinsStore } from '@/stores/pins'
import { useRoutesStore } from '@/stores/routes'

// Distance and public transport time from a listing to the open hunt's pins.
// `compact` (cards) shows the two nearest on one line; the full version
// (detail) lists every pin with the trip's legs.
const props = defineProps<{ listing: MaybeLatLng & { id?: string }; compact?: boolean }>()
const { t, te } = useI18n()
const pinsStore = usePinsStore()
const routesStore = useRoutesStore()

const located = computed(() => hasCoords(props.listing))
const distances = computed(() => {
  const all = pinDistances(props.listing, pinsStore.pins)
  return props.compact ? all.slice(0, 2) : all
})

const currentRoute = useRoute()
/** Pins whose trip is expanded. Collapsed by default; the summary row shows the time. */
const open = ref(new Set<string>())
function toggle(pinId: string) {
  const next = new Set(open.value)
  if (!next.delete(pinId)) next.add(pinId)
  open.value = next
}

function modeLabel(mode: string): string {
  const key = `transit.mode.${mode}`
  return te(key) ? t(key) : t('transit.mode.OTHER')
}

/** "Tram 17", "Metro M1", "Walk". */
function legTitle(leg: RouteLeg): string {
  return leg.line ? `${modeLabel(leg.mode)} ${leg.line}` : modeLabel(leg.mode)
}

/** Transitous names a trip's ends START and END; say where they are instead. */
function placeName(name: string | null, pin: Pin): string | null {
  if (name === 'START') return t('transit.fromListing')
  if (name === 'END') return pin.label
  return name
}

function route(pin: Pin) {
  return props.listing.id ? routesStore.get(props.listing.id, pin.id) : undefined
}
</script>

<template>
  <p
    v-if="compact && distances.length"
    class="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600"
    data-testid="pin-distances"
  >
    <span v-for="{ pin, km } in distances" :key="pin.id" :title="pin.label">
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
      <li v-for="{ pin, km } in distances" :key="pin.id" data-testid="pin-trip">
        <button
          type="button"
          class="flex w-full items-center gap-2 py-2 text-left"
          :aria-expanded="open.has(pin.id)"
          :disabled="route(pin)?.status !== 'ok'"
          data-testid="pin-trip-toggle"
          @click="toggle(pin.id)"
        >
          <span aria-hidden="true">{{ PIN_ICONS[pin.kind] }}</span>
          <span class="min-w-0 flex-1 truncate">{{ pin.label }}</span>
          <span class="text-slate-500">{{ formatDistance(km) }}</span>
          <strong v-if="route(pin)?.status === 'ok'" class="text-slate-900">
            🚆 {{ t('transit.minutes', { n: route(pin)!.duration_min }) }}
          </strong>
          <span
            v-if="route(pin)?.status === 'ok'"
            class="text-slate-400 transition"
            :class="{ 'rotate-90': open.has(pin.id) }"
            aria-hidden="true"
            >›</span
          >
        </button>

        <div
          v-if="route(pin)?.status === 'ok' && open.has(pin.id)"
          class="mb-2 ml-6 space-y-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600"
          data-testid="trip-details"
        >
          <p>
            {{
              route(pin)!.transfers
                ? t('transit.transfers', route(pin)!.transfers!)
                : t('transit.direct')
            }}
            ·
            {{ t('transit.arriveBy', { when: arrivalLabel(pin.arrive_weekday, pin.arrive_time) }) }}
          </p>
          <ol class="space-y-1.5" data-testid="transit-legs">
            <li v-for="(leg, i) in routeLegs(route(pin)!)" :key="i" class="flex gap-2">
              <span class="w-5 shrink-0 text-center" aria-hidden="true">{{
                modeIcon(leg.mode)
              }}</span>
              <span class="min-w-0 flex-1 text-slate-800">
                <strong class="font-semibold">{{ legTitle(leg) }}</strong>
                <template v-if="placeName(leg.from, pin) || placeName(leg.to, pin)">
                  · {{ placeName(leg.from, pin) ?? '…' }} → {{ placeName(leg.to, pin) ?? '…' }}
                </template>
              </span>
              <span class="shrink-0 tabular-nums">{{
                t('transit.minutes', { n: leg.minutes })
              }}</span>
            </li>
          </ol>
          <RouterLink
            v-if="listing.id"
            :to="{
              name: 'map',
              params: { huntId: currentRoute.params.huntId },
              query: { focus: listing.id, route: pin.id },
            }"
            class="inline-block font-semibold text-brand-700"
            data-testid="trip-on-map"
          >
            🗺️ {{ t('transit.showOnMap') }}
          </RouterLink>
        </div>
        <p
          v-else-if="route(pin)?.status === 'no_route'"
          class="-mt-1 mb-2 ml-6 text-xs text-slate-500"
        >
          {{ t('transit.noRoute') }}
        </p>
        <p
          v-else-if="route(pin)?.status === 'error'"
          class="-mt-1 mb-2 ml-6 text-xs text-slate-500"
        >
          {{ t('transit.failed') }}
        </p>
        <p v-else-if="!route(pin) && listing.id" class="-mt-1 mb-2 ml-6 text-xs text-slate-500">
          {{ t('transit.lookingUp') }}
        </p>
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
