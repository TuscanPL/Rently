import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { LatLng, PinKind } from '@at/shared'
import { DEFAULT_CENTER, PIN_ICONS } from './geo'

/** A Leaflet map with OpenStreetMap tiles, centred on Warsaw until told otherwise. */
export function createMap(el: HTMLElement, center: LatLng = DEFAULT_CENTER, zoom = 12): L.Map {
  const map = L.map(el).setView([center.lat, center.lng], zoom)
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  }).addTo(map)
  return map
}

/**
 * Keeps Leaflet's idea of the container size current: the container can still be
 * settling (lazy CSS, layout) when the map is created. Returns a disconnect function.
 */
export function trackSize(map: L.Map, el: HTMLElement, onResize?: () => void): () => void {
  const observer = new ResizeObserver(() => {
    map.invalidateSize()
    onResize?.()
  })
  observer.observe(el)
  return () => observer.disconnect()
}

/** A round emoji badge for a hunt pin, with its label as a tooltip. */
export function pinMarker(pin: LatLng & { label: string; kind: PinKind }): L.Marker {
  const marker = L.marker([pin.lat, pin.lng], {
    icon: L.divIcon({
      className: 'pin-marker',
      html: PIN_ICONS[pin.kind],
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    }),
    title: pin.label,
    alt: pin.label,
    keyboard: false,
    zIndexOffset: 1000,
  })
  // An element, not an HTML string: labels are user input.
  const label = document.createElement('span')
  label.textContent = pin.label
  return marker.bindTooltip(label, { direction: 'top', offset: [0, -14] })
}
