<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import L from 'leaflet'
import type { LatLng } from '@at/shared'
import { geocode } from '@/lib/geo'
import { createMap, trackSize } from '@/lib/leaflet'

// Pick a point by searching an address (geocode function) or tapping the map.
const location = defineModel<LatLng | null>({ required: true })
const props = defineProps<{ city?: string | null; initialQuery?: string }>()
const { t } = useI18n()

const query = ref(props.initialQuery ?? '')
const searching = ref(false)
const message = ref<string | null>(null)
const mapEl = useTemplateRef<HTMLDivElement>('mapEl')
let map: L.Map | null = null
let marker: L.CircleMarker | null = null
let stopTracking: (() => void) | undefined
let userMoved = false

function showMarker(point: LatLng | null, recenter: boolean) {
  if (!map) return
  if (!point) {
    marker?.remove()
    marker = null
    return
  }
  marker ??= L.circleMarker([point.lat, point.lng], {
    radius: 9,
    color: '#ffffff',
    weight: 3,
    fillColor: '#0f766e',
    fillOpacity: 1,
    className: 'picked-marker',
  }).addTo(map)
  marker.setLatLng([point.lat, point.lng])
  if (recenter) map.setView([point.lat, point.lng], Math.max(map.getZoom(), 15))
}

onMounted(() => {
  map = createMap(mapEl.value!, location.value ?? undefined, location.value ? 15 : 12)
  map.on('click', (e: L.LeafletMouseEvent) => {
    message.value = null
    location.value = {
      lat: Number(e.latlng.lat.toFixed(6)),
      lng: Number(e.latlng.lng.toFixed(6)),
    }
  })
  map.on('dragstart', () => (userMoved = true))
  // The container may still be settling: keep the picked point centred until the user pans.
  stopTracking = trackSize(map, mapEl.value!, () => {
    if (location.value && !userMoved) map?.panTo([location.value.lat, location.value.lng])
  })
  showMarker(location.value, false)
})

onBeforeUnmount(() => {
  stopTracking?.()
  map?.remove()
  map = null
})

watch(location, (point) => showMarker(point, false))

async function search() {
  const q = query.value.trim()
  if (q.length < 2) return
  searching.value = true
  message.value = null
  try {
    const res = await geocode(q, props.city)
    if (res.found) {
      location.value = { lat: res.lat, lng: res.lng }
      showMarker(location.value, true)
      message.value = res.displayName
    } else {
      message.value = t('pins.notFound')
    }
  } catch (e) {
    message.value = (e as Error).message
  } finally {
    searching.value = false
  }
}
</script>

<template>
  <div class="space-y-2">
    <!-- Not a <form>: the picker usually sits inside one. -->
    <div class="flex gap-2">
      <input
        v-model="query"
        type="search"
        class="input"
        enterkeyhint="search"
        :aria-label="t('pins.searchLabel')"
        :placeholder="t('pins.searchPlaceholder')"
        data-testid="location-search"
        @keydown.enter.prevent="search"
      />
      <button
        type="button"
        class="btn-secondary shrink-0"
        :disabled="searching || query.trim().length < 2"
        @click="search"
      >
        {{ searching ? t('pins.searching') : t('pins.find') }}
      </button>
    </div>
    <p v-if="message" class="text-xs text-slate-600" role="status">{{ message }}</p>
    <div
      ref="mapEl"
      class="relative z-0 h-56 overflow-hidden rounded-xl border border-slate-200"
      data-testid="location-map"
    />
    <p class="text-xs text-slate-500">
      <template v-if="location">
        {{ t('pins.picked', { lat: location.lat.toFixed(5), lng: location.lng.toFixed(5) }) }}
      </template>
      <template v-else>{{ t('pins.tapHint') }}</template>
    </p>
  </div>
</template>
