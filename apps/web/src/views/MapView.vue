<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import L from 'leaflet'
import { formatArea, formatPLN, hasCoords } from '@at/shared'
import {
  DEFAULT_CENTER,
  MARKER_COLORS,
  PIN_ICONS,
  markerColor,
  markerTone,
  type MarkerVoteState,
} from '@/lib/geo'
import { createMap, pinMarker, trackSize } from '@/lib/leaflet'
import { listingTotal, sortedPhotos } from '@/lib/listings'
import { legSummary, routeSegments } from '@/lib/transit'
import { useRoutesStore } from '@/stores/routes'
import { useVotesStore } from '@/stores/votes'
import { useListingsStore } from '@/stores/listings'
import { usePinsStore } from '@/stores/pins'
import ListingImage from '@/components/ListingImage.vue'
import PinDistances from '@/components/PinDistances.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const routesStore = useRoutesStore()
const votesStore = useVotesStore()
const listingsStore = useListingsStore()
const pinsStore = usePinsStore()
const huntId = route.params.huntId as string

const mapEl = useTemplateRef<HTMLDivElement>('mapEl')
const focusId = typeof route.query.focus === 'string' ? route.query.focus : null
const selectedId = ref<string | null>(focusId)
/** The pin whose public transport trip from the selected listing is drawn. */
const tripPinId = ref<string | null>(
  typeof route.query.route === 'string' ? route.query.route : null,
)

const located = computed(() => listingsStore.listings.filter(hasCoords))
const unlocatedCount = computed(() => listingsStore.listings.length - located.value.length)
const selected = computed(
  () => listingsStore.listings.find((l) => l.id === selectedId.value) ?? null,
)
const selectedPhotos = computed(() => sortedPhotos(selected.value?.listing_photos ?? []))

/** The selected listing's found trips, one chip per pin. */
const selectedTrips = computed(() => {
  const l = selected.value
  if (!l) return []
  return pinsStore.pins.flatMap((pin) => {
    const trip = routesStore.get(l.id, pin.id)
    return trip?.status === 'ok' ? [{ pin, trip }] : []
  })
})
const shownTrip = computed(() => selectedTrips.value.find((s) => s.pin.id === tripPinId.value))

let map: L.Map | null = null
const listingLayer = L.layerGroup()
const pinLayer = L.layerGroup()
const tripLayer = L.layerGroup()
let fitted = false
/** Which listings and pins the current framing covers. */
let framedKey = ''

function voteState(listingId: string): MarkerVoteState {
  const summary = votesStore.summaries[listingId]
  return { myVote: summary?.my_swipe ?? null, isMatch: summary?.is_match ?? false }
}

// Listings and summaries refetch on every hunt event; only redraw when a marker
// actually moves or changes colour, so taps don't land on replaced markers.
const markerKey = computed(() =>
  located.value.map((l) => `${l.id}:${l.lat}:${l.lng}:${markerTone(voteState(l.id))}`).join(),
)

function draw() {
  if (!map) return
  listingLayer.clearLayers()
  pinLayer.clearLayers()
  for (const l of located.value) {
    const state = voteState(l.id)
    const isSelected = l.id === selectedId.value
    L.circleMarker([l.lat, l.lng], {
      radius: isSelected ? 12 : 9,
      color: isSelected ? '#0f172a' : '#ffffff',
      weight: isSelected ? 3 : 2,
      fillColor: markerColor(state),
      fillOpacity: 0.95,
      className: `listing-marker listing-marker--${markerTone(state)}`,
    })
      .on('click', (e) => {
        L.DomEvent.stopPropagation(e)
        selectedId.value = l.id
      })
      .addTo(listingLayer)
  }
  for (const pin of pinsStore.pins) pinMarker(pin).addTo(pinLayer)

  // Frame everything once, after the data has arrived.
  // Re-frame when listings or pins appear later (e.g. a listing geocoded after the
  // map opened), but never after the user has moved the map themselves.
  const key = [...located.value.map((l) => l.id), ...pinsStore.pins.map((p) => p.id)].join()
  if (!listingsStore.loading && !userMoved && key !== framedKey) {
    fitted = true
    framedKey = key
    fit()
  }
}

function drawTrip(frame: boolean) {
  tripLayer.clearLayers()
  const l = selected.value
  const shown = shownTrip.value
  if (!map || !l || !hasCoords(l) || !shown) return
  const segments = routeSegments(shown.trip, l, shown.pin)
  for (const seg of segments) {
    // A white casing under each line keeps it readable on any tile colour.
    L.polyline(seg.points, { color: '#ffffff', weight: 8, opacity: 0.9, interactive: false }).addTo(
      tripLayer,
    )
    L.polyline(seg.points, {
      color: seg.color,
      weight: 5,
      dashArray: seg.dashed ? '2 8' : undefined,
      lineCap: 'round',
      interactive: false,
      className: `trip-line trip-line--${seg.mode.toLowerCase()}`,
    }).addTo(tripLayer)
  }
  if (frame && segments.length) {
    userMoved = true
    map.fitBounds(L.latLngBounds(segments.flatMap((s) => s.points)), {
      paddingTopLeft: [36, 36],
      paddingBottomRight: [36, 220],
      maxZoom: 16,
      animate: false,
    })
  }
}

function toggleTrip(pinId: string) {
  tripPinId.value = tripPinId.value === pinId ? null : pinId
  void router.replace({
    query: {
      ...route.query,
      focus: selectedId.value ?? undefined,
      route: tripPinId.value ?? undefined,
    },
  })
}

function fit() {
  if (!map) return
  const focus = located.value.find((l) => l.id === focusId)
  if (focus) {
    map.setView([focus.lat, focus.lng], 15, { animate: false })
    return
  }
  const points = [...located.value, ...pinsStore.pins].map(
    (p) => [p.lat, p.lng] as [number, number],
  )
  if (points.length === 0)
    map.setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 12, { animate: false })
  else if (points.length === 1) map.setView(points[0]!, 14, { animate: false })
  else {
    // Leave room at the bottom for the mini card.
    map.fitBounds(L.latLngBounds(points), {
      paddingTopLeft: [36, 36],
      paddingBottomRight: [36, 150],
      maxZoom: 15,
      animate: false,
    })
  }
}

let stopTracking: (() => void) | undefined
/** Once the user pans, a late resize no longer re-frames the map under them. */
let userMoved = false

onMounted(() => {
  map = createMap(mapEl.value!)
  tripLayer.addTo(map)
  listingLayer.addTo(map)
  pinLayer.addTo(map)
  map.on('click', () => (selectedId.value = null))
  map.on('dragstart', () => (userMoved = true))
  stopTracking = trackSize(map, mapEl.value!, () => {
    if (fitted && !userMoved) fit()
  })
  draw()
  drawTrip(true)
})

onBeforeUnmount(() => {
  stopTracking?.()
  map?.remove()
  map = null
})

watch([markerKey, () => pinsStore.pins, selectedId, () => listingsStore.loading], draw)
// Picking another listing hides the previous listing's trip.
watch(selectedId, (id, old) => {
  if (old !== null && id !== old) tripPinId.value = null
})
watch(
  () => [shownTrip.value?.trip, selected.value?.lat, selected.value?.lng],
  () => drawTrip(true),
)

const legend = (['match', 'yes', 'maybe', 'no', 'unvoted'] as const).map((tone) => ({
  tone,
  color: MARKER_COLORS[tone],
}))
</script>

<template>
  <div class="-mx-4 -mt-4 space-y-3">
    <div
      class="relative z-0 h-[calc(100dvh-12rem)] min-h-80 md:mx-4 md:mt-4 md:overflow-hidden md:rounded-2xl md:border md:border-slate-200"
    >
      <div ref="mapEl" class="h-full w-full" data-testid="map" />

      <div
        v-if="selected"
        class="absolute inset-x-3 bottom-7 z-[1000] flex gap-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg"
        data-testid="map-card"
      >
        <div class="h-24 w-24 shrink-0">
          <ListingImage
            :photo="selectedPhotos[0]"
            :cover="selectedPhotos.find((p) => p.is_cover) ?? null"
          />
        </div>
        <div class="min-w-0 flex-1 py-2 pr-2">
          <p class="truncate text-sm font-semibold">
            {{ selected.title ?? t('listing.untitled') }}
          </p>
          <p class="font-bold text-brand-800">{{ formatPLN(listingTotal(selected)) }}</p>
          <p class="truncate text-xs text-slate-600">
            {{ formatArea(selected.area_m2) }} ·
            {{ selected.rooms ? t('listing.roomsShort', selected.rooms) : '—' }}
          </p>
          <PinDistances :listing="selected" compact />
          <div v-if="selectedTrips.length" class="mt-1.5 flex flex-wrap gap-1.5">
            <button
              v-for="{ pin, trip } in selectedTrips"
              :key="pin.id"
              type="button"
              class="rounded-full border px-2 py-0.5 text-xs font-medium"
              :class="
                tripPinId === pin.id
                  ? 'border-brand-700 bg-brand-700 text-white'
                  : 'border-slate-300 bg-white text-slate-700'
              "
              :aria-pressed="tripPinId === pin.id"
              data-testid="trip-chip"
              @click="toggleTrip(pin.id)"
            >
              🚆 {{ t('transit.minutes', { n: trip.duration_min }) }} {{ pin.label }}
            </button>
          </div>
          <p v-if="shownTrip" class="mt-1 text-xs text-slate-600" data-testid="map-trip-legs">
            {{ legSummary(shownTrip.trip) }}
          </p>
        </div>
        <div class="flex shrink-0 flex-col items-end justify-between py-1 pr-2">
          <button
            type="button"
            class="flex h-8 w-8 items-center justify-center text-xl text-slate-400"
            :aria-label="t('map.close')"
            @click="selectedId = null"
          >
            ×
          </button>
          <RouterLink
            :to="{ name: 'listing', params: { huntId, listingId: selected.id } }"
            class="mb-1 text-sm font-semibold text-brand-700"
          >
            {{ t('map.details') }} ›
          </RouterLink>
        </div>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 text-xs text-slate-600">
      <span class="font-medium">{{ t('map.legend.title') }}</span>
      <span v-for="item in legend" :key="item.tone" class="flex items-center gap-1">
        <span
          class="inline-block h-3 w-3 rounded-full border border-white shadow"
          :style="{ background: item.color }"
        />
        {{ t(`map.legend.${item.tone}`) }}
      </span>
      <span class="flex items-center gap-1">
        <span aria-hidden="true">{{ PIN_ICONS.other }}</span
        >{{ t('map.legend.pin') }}
      </span>
    </div>
    <p v-if="unlocatedCount" class="px-4 text-sm text-slate-500" data-testid="unlocated">
      {{ t('map.unlocated', unlocatedCount) }}
    </p>
  </div>
</template>
