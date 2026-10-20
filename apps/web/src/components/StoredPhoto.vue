<script setup lang="ts">
import { ref, watch } from 'vue'
import { signedUrl } from '@/lib/photos'

// A user upload from Storage (comment photos), opened full size on tap.
const props = defineProps<{ path: string; alt?: string }>()
const src = ref<string | null>(null)

watch(
  () => props.path,
  async (path) => (src.value = await signedUrl(path)),
  { immediate: true },
)
</script>

<template>
  <a
    v-if="src"
    :href="src"
    target="_blank"
    rel="noopener"
    class="block h-20 w-20 overflow-hidden rounded-xl bg-slate-100"
  >
    <img :src="src" :alt="alt ?? ''" loading="lazy" class="h-full w-full object-cover" />
  </a>
  <span v-else class="block h-20 w-20 rounded-xl bg-slate-100" aria-hidden="true"></span>
</template>
