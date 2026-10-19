<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { formatArea, formatPLN, type Swipe } from '@at/shared'
import { listingTotal, sortedPhotos } from '@/lib/listings'
import type { DeckCard } from '@/lib/votes'
import ListingImage from './ListingImage.vue'
import StarRating from './StarRating.vue'
import CriteriaBadges from './CriteriaBadges.vue'
import PinDistances from './PinDistances.vue'

// One card of the swipe deck. Drag right = yes, left = no, up = maybe; the
// parent's buttons and arrow keys call fling(). Tapping the photo's left or
// right half pages through the photos.
const props = defineProps<{ card: DeckCard; interactive: boolean }>()
const emit = defineEmits<{ swipe: [swipe: Swipe, stars: number | null]; reconsider: [] }>()
const { t } = useI18n()

const THRESHOLD = 100

const listing = computed(() => props.card.listing)
const photos = computed(() => sortedPhotos(listing.value.listing_photos))
const cover = computed(() => photos.value.find((p) => p.is_cover) ?? null)
const photoIndex = ref(0)
const stars = ref<number | null>(null)

const dx = ref(0)
const dy = ref(0)
const dragging = ref(false)
const leaving = ref<Swipe | null>(null)
let start = { x: 0, y: 0 }
let moved = false

watch(
  () => props.card.listing_id,
  () => {
    photoIndex.value = 0
    stars.value = null
    dx.value = dy.value = 0
    leaving.value = null
  },
)

/** Which way the card is being dragged, once it's past the threshold. */
function direction(): Swipe | null {
  if (-dy.value > THRESHOLD && -dy.value > Math.abs(dx.value)) return 'maybe'
  if (dx.value > THRESHOLD) return 'yes'
  if (dx.value < -THRESHOLD) return 'no'
  return null
}

const clamp = (v: number) => Math.min(1, Math.max(0, v))
const overlay = computed(() => {
  if (leaving.value) return { yes: 0, no: 0, maybe: 0, [leaving.value]: 1 }
  const up = -dy.value > Math.abs(dx.value)
  return {
    yes: up ? 0 : clamp(dx.value / THRESHOLD),
    no: up ? 0 : clamp(-dx.value / THRESHOLD),
    maybe: up ? clamp(-dy.value / THRESHOLD) : 0,
  }
})

const style = computed(() => ({
  transform: `translate(${dx.value}px, ${dy.value}px) rotate(${dx.value / 18}deg)`,
  transition: dragging.value ? 'none' : 'transform 0.3s ease-out',
}))

function onPointerDown(e: PointerEvent) {
  if (!props.interactive || leaving.value || e.button !== 0) return
  if ((e.target as HTMLElement).closest('button, a, input, textarea')) return
  start = { x: e.clientX, y: e.clientY }
  moved = false
  dragging.value = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  dx.value = e.clientX - start.x
  dy.value = e.clientY - start.y
  if (Math.hypot(dx.value, dy.value) > 8) moved = true
}

function onPointerUp(e: PointerEvent) {
  if (!dragging.value) return
  dragging.value = false
  if (!moved) {
    dx.value = dy.value = 0
    tapPhoto(e)
    return
  }
  const dir = direction()
  if (dir) fling(dir)
  else dx.value = dy.value = 0
}

function onPointerCancel() {
  dragging.value = false
  dx.value = dy.value = 0
}

function tapPhoto(e: PointerEvent) {
  const photo = (e.target as HTMLElement).closest('[data-photo]')
  if (!photo || photos.value.length < 2) return
  const rect = photo.getBoundingClientRect()
  const step = e.clientX - rect.left < rect.width / 2 ? -1 : 1
  photoIndex.value = Math.min(photos.value.length - 1, Math.max(0, photoIndex.value + step))
}

/** Animates the card off screen, then reports the swipe. */
function fling(swipe: Swipe) {
  if (leaving.value) return
  leaving.value = swipe
  const w = window.innerWidth
  if (swipe === 'yes') dx.value = w * 1.2
  else if (swipe === 'no') dx.value = -w * 1.2
  else dy.value = -window.innerHeight
  setTimeout(() => emit('swipe', swipe, stars.value), 280)
}

defineExpose({ fling })
</script>

<template>
  <article
    class="absolute inset-0 flex touch-none flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl select-none"
    :class="interactive ? 'cursor-grab active:cursor-grabbing' : ''"
    :style="style"
    :aria-label="listing.title ?? t('listing.untitled')"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
  >
    <div class="relative min-h-0 flex-1 bg-slate-100" data-photo>
      <ListingImage
        :photo="photos[photoIndex]"
        :cover="cover"
        :alt="listing.title ?? ''"
        class="pointer-events-none"
        draggable="false"
      />

      <div class="absolute inset-x-0 top-0 space-y-2 p-2">
        <div v-if="photos.length > 1" class="flex gap-1" aria-hidden="true">
          <span
            v-for="(p, i) in photos"
            :key="p.id"
            class="h-1 flex-1 rounded-full"
            :class="i === photoIndex ? 'bg-white' : 'bg-white/40'"
          ></span>
        </div>

        <div
          v-if="card.deck_group === 1"
          class="rounded-2xl bg-sky-600/95 px-3 py-2 text-sm text-white shadow"
          data-testid="reconsider-banner"
        >
          <p class="font-semibold">
            ↩ {{ t('deck.reconsiderAsk', { name: card.reconsider_requested_by }) }}
          </p>
          <p v-if="card.reconsider_note" class="mt-0.5 italic">“{{ card.reconsider_note }}”</p>
        </div>

        <div
          v-if="card.rejected_by.length"
          class="flex items-center gap-2 rounded-2xl bg-rose-600/95 py-1.5 pr-1.5 pl-3 text-sm text-white shadow"
          data-testid="rejected-banner"
        >
          <span class="flex-1 font-semibold">
            {{ t('deck.rejectedBy', { names: card.rejected_by.join(', ') }) }}
          </span>
          <span v-if="card.reconsider_pending" class="px-2 text-xs text-rose-100">
            {{ t('reconsider.pending') }}
          </span>
          <button
            v-else
            type="button"
            class="rounded-xl bg-white px-3 py-1 text-xs font-semibold text-rose-700"
            :disabled="!interactive"
            @click="emit('reconsider')"
          >
            {{ t('reconsider.button') }}
          </button>
        </div>

        <span
          v-if="card.still_no"
          class="inline-block rounded-full bg-slate-900/80 px-2.5 py-0.5 text-xs font-semibold text-white"
          data-testid="still-no"
        >
          {{ t('deck.stillNo') }}
        </span>
      </div>

      <!-- Drag feedback -->
      <span
        class="pointer-events-none absolute top-1/3 left-5 -rotate-12 rounded-xl border-4 border-emerald-500 px-3 py-1 text-3xl font-black tracking-wider text-emerald-500"
        :style="{ opacity: overlay.yes }"
        aria-hidden="true"
        >{{ t('deck.stamp.yes') }}</span
      >
      <span
        class="pointer-events-none absolute top-1/3 right-5 rotate-12 rounded-xl border-4 border-rose-500 px-3 py-1 text-3xl font-black tracking-wider text-rose-500"
        :style="{ opacity: overlay.no }"
        aria-hidden="true"
        >{{ t('deck.stamp.no') }}</span
      >
      <span
        class="pointer-events-none absolute bottom-1/3 left-1/2 -translate-x-1/2 rounded-xl border-4 border-amber-500 px-3 py-1 text-3xl font-black tracking-wider text-amber-500"
        :style="{ opacity: overlay.maybe }"
        aria-hidden="true"
        >{{ t('deck.stamp.maybe') }}</span
      >

      <div
        class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-4 pt-10 pb-3 text-white"
      >
        <p class="text-3xl font-bold" data-testid="card-total">
          {{ formatPLN(listingTotal(listing)) }}
        </p>
        <p class="text-xs text-white/80">{{ t('deck.perMonth') }}</p>
        <p class="mt-1 text-sm font-medium">
          {{ formatArea(listing.area_m2) }} ·
          {{ listing.rooms ? t('listing.roomsShort', listing.rooms) : '—' }}
          <template v-if="listing.district"> · {{ listing.district }}</template>
        </p>
      </div>
    </div>

    <div class="space-y-2 px-4 pt-3 pb-3">
      <div class="flex items-start gap-2">
        <p class="line-clamp-2 flex-1 leading-snug font-semibold">
          {{ listing.title ?? t('listing.untitled') }}
        </p>
        <RouterLink
          :to="{ name: 'listing', params: { huntId: listing.hunt_id, listingId: listing.id } }"
          class="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700"
          :tabindex="interactive ? 0 : -1"
        >
          {{ t('deck.details') }}
        </RouterLink>
      </div>
      <div class="flex flex-wrap gap-1.5 empty:hidden">
        <span
          v-if="listing.needs_details"
          class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
        >
          {{ t('listing.needsDetails') }}
        </span>
        <span
          v-if="!listing.is_active"
          class="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700"
        >
          {{ t('listing.adRemoved') }}
        </span>
        <CriteriaBadges :listing="listing" />
      </div>
      <PinDistances :listing="listing" />
      <div class="flex items-center justify-between">
        <span class="text-xs text-slate-500">{{ t('deck.yourRating') }}</span>
        <StarRating v-model="stars" size="sm" :disabled="!interactive" />
      </div>
    </div>
  </article>
</template>
