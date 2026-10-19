<script setup lang="ts">
import { ref, watch } from 'vue'
import { supabase } from '@/lib/supabase'
import { signedUrl } from '@/lib/photos'
import type { ListingPhoto } from '@/lib/listings'

// Linked photos load straight from the listing site (no referrer avoids most
// hotlink blocks). When one fails, fall back to the cached cover and stop retrying it.
const props = defineProps<{
  photo?: ListingPhoto | null
  cover?: ListingPhoto | null
  alt?: string
}>()

const src = ref<string | null>(null)
const failed = ref(false)

async function resolve() {
  failed.value = false
  const p = props.photo
  if (p?.original_url && !p.broken) {
    src.value = p.original_url
    return
  }
  await fallback()
}

async function fallback() {
  const path = props.photo?.storage_path ?? props.cover?.storage_path
  src.value = path ? await signedUrl(path) : null
  if (!src.value) failed.value = true
}

async function onError() {
  const p = props.photo
  if (p && src.value === p.original_url) {
    if (!p.broken) {
      p.broken = true
      void supabase.from('listing_photos').update({ broken: true }).eq('id', p.id)
    }
    await fallback()
  } else {
    failed.value = true
  }
}

watch(() => [props.photo?.id, props.cover?.id], resolve, { immediate: true })
</script>

<template>
  <img
    v-if="src && !failed"
    :src="src"
    :alt="alt ?? ''"
    referrerpolicy="no-referrer"
    loading="lazy"
    decoding="async"
    class="h-full w-full object-cover"
    @error="onError"
  />
  <div
    v-else
    class="flex h-full w-full items-center justify-center bg-slate-100 text-4xl text-slate-300"
    aria-hidden="true"
  >
    🏠
  </div>
</template>
