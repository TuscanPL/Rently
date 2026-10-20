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
import StatusSheet from '@/components/StatusSheet.vue'

// Kanban of the status pipeline. Desktop: drag cards between columns. Phone:
// the columns scroll sideways and tapping a card opens the status sheet.
const { t, d } = useI18n()
const route = useRoute()
const auth = useAuthStore()
const listingsStore = useListingsStore()
const votes = useVotesStore()
const downloadViewing = useViewingIcs()

const sheet = ref<{ listing: ListingWithPhotos; startWith: ListingStatus | null } | null>(null)
const dragId = ref<string | null>(null)
const dropTarget = ref<ListingStatus | null>(null)
const error = ref<string | null>(null)

const columns = computed(() =>
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

function onDragStart(e: DragEvent, l: ListingWithPhotos) {
  dragId.value = l.id
  e.dataTransfer?.setData('text/plain', l.id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragEnd() {
  dragId.value = null
  dropTarget.value = null
}

async function onDrop(e: DragEvent, status: ListingStatus) {
  const id = e.dataTransfer?.getData('text/plain') || dragId.value
  onDragEnd()
  const l = id ? listingsStore.byId(id) : null
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

      <div
        class="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 md:snap-none"
        data-testid="pipeline"
      >
        <section
          v-for="col in columns"
          :key="col.status"
          class="flex w-[78vw] max-w-72 shrink-0 snap-start flex-col rounded-2xl bg-slate-100 p-2 transition md:w-60"
          :class="{ 'bg-brand-50 ring-2 ring-brand-500': dropTarget === col.status }"
          :data-testid="`column-${col.status}`"
          :aria-label="t(`pipeline.status.${col.status}`)"
          @dragover.prevent="dropTarget = col.status"
          @dragleave="dropTarget === col.status && (dropTarget = null)"
          @drop.prevent="onDrop($event, col.status)"
        >
          <h3 class="flex items-center gap-2 px-1 pb-2 text-sm font-semibold">
            <span class="rounded-full px-2 py-0.5" :class="STATUS_CLASSES[col.status]">
              {{ t(`pipeline.status.${col.status}`) }}
            </span>
            <span class="text-slate-500">{{ col.items.length }}</span>
          </h3>

          <ul class="flex min-h-16 flex-1 flex-col gap-2">
            <li
              v-for="l in col.items"
              :key="l.id"
              class="rounded-xl border border-slate-200 bg-white shadow-sm md:cursor-grab"
              :class="{ 'opacity-50': dragId === l.id }"
              draggable="true"
              data-testid="pipeline-card"
              @dragstart="onDragStart($event, l)"
              @dragend="onDragEnd"
            >
              <button
                type="button"
                class="block w-full p-3 text-left"
                :aria-label="t('pipeline.change') + ': ' + (l.title ?? t('listing.untitled'))"
                @click="sheet = { listing: l, startWith: null }"
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
            </li>
            <li
              v-if="!col.items.length"
              class="rounded-xl border-2 border-dashed border-slate-200 p-3 text-center text-xs text-slate-400"
            >
              {{ t('pipeline.empty') }}
            </li>
          </ul>
        </section>
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
