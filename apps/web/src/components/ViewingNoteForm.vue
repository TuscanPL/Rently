<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { VIEWING_ASPECTS, VIEWING_RATINGS, type ViewingRatings } from '@at/shared'
import { postComment, type Comment } from '@/lib/comments'
import type { PickedPhoto } from '@/lib/photos'
import { RATING_STYLES } from '@/lib/viewingNotes'
import PhotoPicker from './PhotoPicker.vue'

// The post-viewing note: smell, light, noise and landlord vibe as good / ok /
// bad, free text and photos. Saved as a comment with kind = 'viewing_note'.
const props = defineProps<{ huntId: string; listingId: string }>()
const emit = defineEmits<{ saved: [comment: Comment]; later: [] }>()
const { t } = useI18n()

const ratings = ref<ViewingRatings>({})
const body = ref('')
const photos = ref<PickedPhoto[]>([])
const busy = ref<string | null>(null)
const error = ref<string | null>(null)

function rate(aspect: keyof ViewingRatings, value: (typeof VIEWING_RATINGS)[number]) {
  // Tapping the chosen rating again clears it.
  const next = { ...ratings.value }
  if (next[aspect] === value) delete next[aspect]
  else next[aspect] = value
  ratings.value = next
}

async function save() {
  if (!Object.keys(ratings.value).length && !body.value.trim() && !photos.value.length) {
    error.value = t('viewingNotes.needOne')
    return
  }
  error.value = null
  busy.value = t('common.saving')
  try {
    const comment = await postComment({
      huntId: props.huntId,
      listingId: props.listingId,
      body: body.value,
      photos: photos.value,
      kind: 'viewing_note',
      ratings: ratings.value,
      onUpload: (n, total) => (busy.value = t('comments.uploading', { n, total })),
    })
    emit('saved', comment)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <form
    class="space-y-4 rounded-2xl border border-violet-200 bg-violet-50 p-4"
    data-testid="viewing-note-form"
    @submit.prevent="save"
  >
    <div>
      <h3 class="font-semibold text-violet-950">{{ t('viewingNotes.promptTitle') }}</h3>
      <p class="text-sm text-violet-900/80">{{ t('viewingNotes.promptHelp') }}</p>
    </div>

    <div class="space-y-2">
      <div
        v-for="aspect in VIEWING_ASPECTS"
        :key="aspect"
        class="flex items-center gap-2"
        role="group"
        :aria-label="t(`viewingNotes.aspects.${aspect}`)"
      >
        <span class="w-28 shrink-0 text-sm font-medium">
          {{ t(`viewingNotes.aspects.${aspect}`) }}
        </span>
        <div class="grid flex-1 grid-cols-3 gap-1.5">
          <button
            v-for="value in VIEWING_RATINGS"
            :key="value"
            type="button"
            class="rounded-xl border px-1 py-1.5 text-sm font-medium transition"
            :class="
              ratings[aspect] === value
                ? RATING_STYLES[value].active
                : 'border-slate-200 bg-white text-slate-600'
            "
            :aria-pressed="ratings[aspect] === value"
            @click="rate(aspect, value)"
          >
            {{ RATING_STYLES[value].icon }} {{ t(`viewingNotes.ratings.${value}`) }}
          </button>
        </div>
      </div>
    </div>

    <div>
      <label class="label" for="note-body">{{ t('viewingNotes.textLabel') }}</label>
      <textarea
        id="note-body"
        v-model="body"
        rows="3"
        maxlength="4000"
        class="input"
        :placeholder="t('viewingNotes.textPlaceholder')"
      ></textarea>
    </div>
    <PhotoPicker v-model="photos" testid="note-photo-input" />

    <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>
    <div class="flex gap-3">
      <button type="button" class="btn-secondary" @click="emit('later')">
        {{ t('viewingNotes.later') }}
      </button>
      <button type="submit" class="btn-primary flex-1" :disabled="!!busy">
        {{ busy ?? t('viewingNotes.save') }}
      </button>
    </div>
  </form>
</template>
