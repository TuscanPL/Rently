<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PickedPhoto } from '@/lib/photos'

// Small thumbnails of picked photos plus an add tile. The parent uploads them.
const photos = defineModel<PickedPhoto[]>({ required: true })
defineProps<{ max?: number; testid?: string }>()
const { t } = useI18n()

function onFiles(event: Event) {
  const input = event.target as HTMLInputElement
  for (const file of input.files ?? []) {
    if (file.type.startsWith('image/'))
      photos.value = [...photos.value, { file, preview: URL.createObjectURL(file) }]
  }
  input.value = ''
}

function remove(i: number) {
  const removed = photos.value[i]
  if (removed) URL.revokeObjectURL(removed.preview)
  photos.value = photos.value.filter((_, j) => j !== i)
}

onBeforeUnmount(() => photos.value.forEach((p) => URL.revokeObjectURL(p.preview)))
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <div
      v-for="(p, i) in photos"
      :key="p.preview"
      class="relative h-16 w-16 overflow-hidden rounded-xl"
    >
      <img :src="p.preview" alt="" class="h-full w-full object-cover" />
      <button
        type="button"
        class="absolute top-0.5 right-0.5 h-6 w-6 rounded-full bg-slate-900/70 text-xs text-white"
        :aria-label="t('comments.removePhoto')"
        @click="remove(i)"
      >
        ✕
      </button>
    </div>
    <label
      v-if="photos.length < (max ?? 10)"
      class="flex h-16 w-16 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-center text-[11px] leading-tight text-slate-500"
    >
      <span class="text-xl leading-none">📷</span>{{ t('comments.addPhotos') }}
      <input
        type="file"
        accept="image/*"
        multiple
        class="sr-only"
        :data-testid="testid"
        @change="onFiles"
      />
    </label>
  </div>
</template>
