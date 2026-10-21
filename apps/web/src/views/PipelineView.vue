<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { formatPLN, type ListingStatus } from '@at/shared'
import { supabase } from '@/lib/supabase'
import { listingTotal, type ListingWithPhotos } from '@/lib/listings'
import { PIPELINE_COLUMNS, STATUS_CLASSES, wantsViewingNote } from '@/lib/pipeline'
import { SWIPE_ICONS } from '@/lib/votes'
import { useViewingIcs } from '@/lib/useViewingIcs'
import { useAuthStore } from '@/stores/auth'
import { useListingsStore } from '@/stores/listings'
import { useVotesStore } from '@/stores/votes'
import { useSectionDrag } from '@/lib/useSectionDrag'
import StatusSheet from '@/components/StatusSheet.vue'

// The status pipeline as stacked rows, one per stage from "New" down to the
// outcomes, so it reads top to bottom on a phone. Drag a card up or down to
// another stage (by its handle on touch, anywhere with a mouse), or tap it to
// pick the stage from a sheet.
const { t, d } = useI18n()
const route = useRoute()
const auth = useAuthStore()
const listingsStore = useListingsStore()
const votes = useVotesStore()
const downloadViewing = useViewingIcs()

const sheet = ref<{ listing: ListingWithPhotos; startWith: ListingStatus | null } | null>(null)
const error = ref<string | null>(null)

const stages = computed(() =>
  PIPELINE_COLUMNS.map((status) => {
    const items = listingsStore.listings.filter((l) => l.status === status)
    // Upcoming viewings soonest first; everything else most recently moved first.
    if (status === 'viewing_booked')
      items.sort((a, b) => (a.viewing_at ?? '9').localeCompare(b.viewing_at ?? '9'))
    else items.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    return { status, items }
  }),
)

// Listings after their viewing where I haven't written my note yet.
const myNotes = ref(new Set<string>())
const viewedIds = computed(() =>
  listingsStore.listings.filter((l) => wantsViewingNote(l.status)).map((l) => l.id),
)
watch(
  () => viewedIds.value.join(','),
  async () => {
    if (!viewedIds.value.length) return
    const { data } = await supabase
      .from('comments')
      .select('listing_id')
      .eq('kind', 'viewing_note')
      .eq('user_id', auth.userId!)
      .in('listing_id', viewedIds.value)
    myNotes.value = new Set((data ?? []).map((c) => c.listing_id))
  },
  { immediate: true },
)
const notePending = (l: ListingWithPhotos) => wantsViewingNote(l.status) && !myNotes.value.has(l.id)

async function moveTo(id: string, status: ListingStatus) {
  const l = listingsStore.byId(id)
  if (!l || l.status === status) return
  // A booked viewing needs its date and time first.
  if (status === 'viewing_booked') {
    sheet.value = { listing: l, startWith: status }
    return
  }
  error.value = null
  try {
    await listingsStore.setStatus(l.id, status)
  } catch (err) {
    error.value = (err as Error).message
  }
}

const drag = useSectionDrag<ListingStatus>({ onDrop: (id, status) => void moveTo(id, status) })

function openSheet(l: ListingWithPhotos) {
  if (drag.swallowClick()) return
  sheet.value = { listing: l, startWith: null }
}
</script>

<template>
  <div class="space-y-3">
    <div
      v-if="!listingsStore.loading && listingsStore.listings.length === 0"
      class="card mt-6 space-y-3 text-center text-slate-600"
    >
      <p class="text-4xl">📋</p>
      <p>{{ t('pipeline.noListings') }}</p>
      <RouterLink
        :to="{ name: 'add', params: { huntId: route.params.huntId } }"
        class="btn-primary"
      >
        {{ t('add.title') }}
      </RouterLink>
    </div>

    <template v-else>
      <p class="text-sm text-slate-500">{{ t('pipeline.hint') }}</p>
      <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>

      <div class="space-y-3" data-testid="pipeline">
        <section
          v-for="stage in stages"
          :key="stage.status"
          class="rounded-2xl bg-slate-100 p-2 transition"
          :class="{ 'bg-brand-50 ring-2 ring-brand-500': drag.overTarget.value === stage.status }"
          :data-drop-target="stage.status"
          :data-testid="`column-${stage.status}`"
          :aria-label="t(`pipeline.status.${stage.status}`)"
        >
          <h3
            class="flex items-center gap-2 px-1 text-sm font-semibold"
            :class="{ 'pb-2': stage.items.length }"
          >
            <span class="rounded-full px-2 py-0.5" :class="STATUS_CLASSES[stage.status]">
              {{ t(`pipeline.status.${stage.status}`) }}
            </span>
            <span class="text-slate-500">{{ stage.items.length }}</span>
            <span
              v-if="!stage.items.length && drag.draggingId.value"
              class="ml-auto text-xs font-normal text-slate-400"
            >
              {{ t('pipeline.dropHere') }}
            </span>
          </h3>

          <ul v-if="stage.items.length" class="flex flex-col gap-2">
            <li
              v-for="l in stage.items"
              :key="l.id"
              class="flex rounded-xl border border-slate-200 bg-white shadow-sm select-none md:cursor-grab"
              :class="{ 'opacity-40': drag.draggingId.value === l.id }"
              data-testid="pipeline-card"
              @pointerdown="drag.start($event, l.id, l.title ?? t('listing.untitled'), false)"
            >
              <div class="min-w-0 flex-1">
                <button
                  type="button"
                  class="block w-full p-3 text-left"
                  :aria-label="t('pipeline.change') + ': ' + (l.title ?? t('listing.untitled'))"
                  @click="openSheet(l)"
                >
                  <p class="line-clamp-2 text-sm leading-snug font-semibold">
                    {{ l.title ?? t('listing.untitled') }}
                  </p>
                  <p class="mt-1 text-sm">
                    <span class="font-bold text-brand-800">{{ formatPLN(listingTotal(l)) }}</span>
                    <span v-if="l.district" class="text-slate-500"> · {{ l.district }}</span>
                  </p>
                  <p v-if="votes.summaries[l.id]?.my_swipe" class="mt-0.5 text-xs text-slate-500">
                    {{ t('votes.mine') }}:
                    {{ SWIPE_ICONS[votes.summaries[l.id]!.my_swipe!] }}
                    {{ t(`votes.swipe.${votes.summaries[l.id]!.my_swipe}`) }}
                  </p>
                </button>
                <div
                  v-if="(l.status === 'viewing_booked' && l.viewing_at) || notePending(l)"
                  class="space-y-1.5 border-t border-slate-100 px-3 py-2"
                >
                  <div
                    v-if="l.status === 'viewing_booked' && l.viewing_at"
                    class="flex items-center gap-2 text-xs"
                  >
                    <span class="flex-1 font-medium text-violet-800" data-testid="viewing-at">
                      🗓 {{ d(new Date(l.viewing_at), 'viewing') }}
                    </span>
                    <button
                      type="button"
                      class="rounded-lg bg-slate-100 px-2 py-1 font-medium text-slate-700"
                      @click="downloadViewing(l)"
                    >
                      .ics
                    </button>
                  </div>
                  <RouterLink
                    v-if="notePending(l)"
                    :to="{
                      name: 'listing',
                      params: { huntId: l.hunt_id, listingId: l.id },
                      query: { note: '1' },
                    }"
                    class="block rounded-lg bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800"
                    data-testid="note-pending"
                  >
                    📝 {{ t('pipeline.notePending') }}
                  </RouterLink>
                </div>
              </div>
              <!-- Touch drags start here; touch-action none keeps the finger from scrolling. -->
              <span
                class="flex w-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-r-xl border-l border-slate-100 text-xl text-slate-400 active:bg-slate-50"
                role="img"
                :aria-label="t('pipeline.dragHandle')"
                data-testid="drag-handle"
                @pointerdown="drag.start($event, l.id, l.title ?? t('listing.untitled'), true)"
              >
                ⠿
              </span>
            </li>
          </ul>
        </section>
      </div>

      <!-- Follows the finger while dragging. -->
      <div
        v-if="drag.ghost.value"
        class="pointer-events-none fixed z-50 max-w-64 -translate-x-1/2 -translate-y-1/2 truncate rounded-xl border border-brand-500 bg-white px-3 py-2 text-sm font-semibold shadow-xl"
        :style="{ left: `${drag.ghost.value.x}px`, top: `${drag.ghost.value.y}px` }"
      >
        {{ drag.ghost.value.label }}
      </div>
    </template>

    <StatusSheet
      v-if="sheet"
      :listing="sheet.listing"
      :start-with="sheet.startWith"
      @close="sheet = null"
    />
  </div>
</template>
