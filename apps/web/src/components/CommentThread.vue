<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { VIEWING_ASPECTS } from '@at/shared'
import { supabase } from '@/lib/supabase'
import { postComment, viewingRatings, type Comment } from '@/lib/comments'
import type { PickedPhoto } from '@/lib/photos'
import type { ListingWithPhotos } from '@/lib/listings'
import { wantsViewingNote } from '@/lib/pipeline'
import { RATING_STYLES } from '@/lib/viewingNotes'
import { useAuthStore } from '@/stores/auth'
import { useHuntsStore } from '@/stores/hunts'
import PhotoPicker from './PhotoPicker.vue'
import StoredPhoto from './StoredPhoto.vue'
import ViewingNoteForm from './ViewingNoteForm.vue'

// The listing's comment thread, live over Realtime. After the viewing, each
// member is asked for a viewing note, which shows up here with its ratings.
const props = defineProps<{ listing: ListingWithPhotos }>()
// Viewing notes also appear in the listing's history.
const emit = defineEmits<{ noteAdded: [] }>()
const { t, d } = useI18n()
const auth = useAuthStore()
const huntsStore = useHuntsStore()
const route = useRoute()
const noteForm = ref<HTMLElement | null>(null)

// Ref<T> instead of ref<T>(): unwrapping the Json ratings column trips TS2589.
const comments = ref([]) as Ref<Comment[]>
const loaded = ref(false)
const body = ref('')
const photos = ref<PickedPhoto[]>([])
const busy = ref<string | null>(null)
const error = ref<string | null>(null)
/** "Later" on the note prompt hides it until the next visit. */
const noteDismissed = ref(false)
const noteOpen = ref(false)
let channel: RealtimeChannel | null = null

const names = computed(
  () => new Map(huntsStore.members.map((m) => [m.user_id, m.profiles?.display_name ?? ''])),
)
const nameOf = (userId: string) => names.value.get(userId) || t('listing.someone')

const iWroteNote = computed(() =>
  comments.value.some((c) => c.kind === 'viewing_note' && c.user_id === auth.userId),
)
const showNotePrompt = computed(
  () =>
    loaded.value &&
    wantsViewingNote(props.listing.status) &&
    !iWroteNote.value &&
    !noteDismissed.value,
)

function add(c: Comment) {
  if (comments.value.some((x) => x.id === c.id)) return
  comments.value = [...comments.value, c].sort((a, b) => a.created_at.localeCompare(b.created_at))
  if (c.kind === 'viewing_note') emit('noteAdded')
}

async function load(listingId: string) {
  loaded.value = false
  const { data, error: err } = await supabase
    .from('comments')
    .select('*')
    .eq('listing_id', listingId)
    .order('created_at')
  if (err) error.value = err.message
  comments.value = data ?? []
  loaded.value = true
  // The pipeline's "add your note" nudge links here with ?note=1.
  if (route.query.note && showNotePrompt.value) {
    await nextTick()
    noteForm.value?.scrollIntoView({ block: 'start' })
  }
}

function subscribe(listingId: string) {
  if (channel) void supabase.removeChannel(channel)
  channel = supabase
    .channel(`comments:${listingId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'comments',
        filter: `listing_id=eq.${listingId}`,
      },
      ({ new: row }) => add(row as Comment),
    )
    // Deletes can't be filtered; they only carry the id, so drop it if it's ours.
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'comments' }, ({ old }) => {
      comments.value = comments.value.filter((c) => c.id !== (old as { id?: string }).id)
    })
    .subscribe()
}

watch(
  () => props.listing.id,
  (id) => {
    noteDismissed.value = false
    noteOpen.value = false
    subscribe(id)
    void load(id)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (channel) void supabase.removeChannel(channel)
})

async function send() {
  if (!body.value.trim() && !photos.value.length) return
  error.value = null
  busy.value = t('comments.sending')
  try {
    add(
      await postComment({
        huntId: props.listing.hunt_id,
        listingId: props.listing.id,
        body: body.value,
        photos: photos.value,
        onUpload: (n, total) => (busy.value = t('comments.uploading', { n, total })),
      }),
    )
    body.value = ''
    photos.value = []
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = null
  }
}

async function remove(c: Comment) {
  if (!confirm(t('comments.deleteConfirm'))) return
  const { error: err } = await supabase.from('comments').delete().eq('id', c.id)
  if (err) error.value = err.message
  else comments.value = comments.value.filter((x) => x.id !== c.id)
}

function onNoteSaved(c: Comment) {
  add(c)
  noteOpen.value = false
}
</script>

<template>
  <section class="space-y-3" data-testid="comments">
    <div ref="noteForm" class="scroll-mt-20"></div>
    <ViewingNoteForm
      v-if="showNotePrompt || noteOpen"
      :hunt-id="listing.hunt_id"
      :listing-id="listing.id"
      @saved="onNoteSaved"
      @later="((noteDismissed = true), (noteOpen = false))"
    />

    <div class="card space-y-4">
      <div class="flex items-center justify-between gap-3">
        <h3 class="font-semibold">{{ t('comments.title') }}</h3>
        <button
          v-if="wantsViewingNote(listing.status) && !iWroteNote && !showNotePrompt && !noteOpen"
          type="button"
          class="text-sm text-brand-700"
          @click="noteOpen = true"
        >
          📝 {{ t('viewingNotes.add') }}
        </button>
      </div>

      <p v-if="loaded && !comments.length" class="text-sm text-slate-500">
        {{ t('comments.empty') }}
      </p>
      <ol class="space-y-3" data-testid="comment-list">
        <li
          v-for="c in comments"
          :key="c.id"
          class="rounded-2xl p-3"
          :class="
            c.kind === 'viewing_note' ? 'border border-violet-200 bg-violet-50' : 'bg-slate-50'
          "
          :data-kind="c.kind"
          data-testid="comment"
        >
          <div class="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span class="min-w-0 truncate font-semibold">{{ nameOf(c.user_id) }}</span>
            <span
              v-if="c.kind === 'viewing_note'"
              class="rounded-full bg-violet-200 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-violet-900"
            >
              📝 {{ t('viewingNotes.badge') }}
            </span>
            <span class="ml-auto shrink-0 text-xs text-slate-500">
              {{ d(new Date(c.created_at), 'long') }}
            </span>
          </div>
          <ul
            v-if="c.kind === 'viewing_note' && Object.keys(viewingRatings(c)).length"
            class="mb-2 flex flex-wrap gap-1.5 text-xs"
            data-testid="note-ratings"
          >
            <template v-for="aspect in VIEWING_ASPECTS" :key="aspect">
              <li
                v-if="viewingRatings(c)[aspect]"
                class="rounded-full px-2 py-0.5 font-medium"
                :class="RATING_STYLES[viewingRatings(c)[aspect]!].chip"
              >
                {{ t(`viewingNotes.aspects.${aspect}`) }}:
                {{ RATING_STYLES[viewingRatings(c)[aspect]!].icon }}
                {{ t(`viewingNotes.ratings.${viewingRatings(c)[aspect]}`) }}
              </li>
            </template>
          </ul>
          <p v-if="c.body" class="text-sm whitespace-pre-line text-slate-800">{{ c.body }}</p>
          <div v-if="c.photo_paths.length" class="mt-2 flex flex-wrap gap-2">
            <StoredPhoto
              v-for="path in c.photo_paths"
              :key="path"
              :path="path"
              :alt="t('comments.photo', { name: nameOf(c.user_id) })"
            />
          </div>
          <button
            v-if="c.user_id === auth.userId"
            type="button"
            class="mt-1 text-xs text-slate-500 hover:text-rose-700"
            @click="remove(c)"
          >
            {{ t('comments.delete') }}
          </button>
        </li>
      </ol>

      <form class="space-y-2" @submit.prevent="send">
        <label class="sr-only" for="comment-body">{{ t('comments.label') }}</label>
        <textarea
          id="comment-body"
          v-model="body"
          rows="2"
          maxlength="4000"
          class="input"
          :placeholder="t('comments.placeholder')"
          @keydown.enter.ctrl.prevent="send"
          @keydown.enter.meta.prevent="send"
        ></textarea>
        <div class="flex items-end gap-3">
          <div class="flex-1"><PhotoPicker v-model="photos" testid="comment-photo-input" /></div>
          <button
            type="submit"
            class="btn-primary"
            :disabled="!!busy || (!body.trim() && !photos.length)"
          >
            {{ busy ?? t('comments.send') }}
          </button>
        </div>
        <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>
      </form>
    </div>
  </section>
</template>
