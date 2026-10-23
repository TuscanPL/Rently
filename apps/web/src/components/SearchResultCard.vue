<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatArea, formatPLN } from '@at/shared'
import { resultDetail, resultPhotos, resultTotal, type SearchResult } from '@/lib/browse'

// One ad from a saved Otodom search. Its photos swipe sideways; the results
// list only has a few, so reaching the last one asks for the full ad (once),
// which brings the rest.
const props = defineProps<{
  result: SearchResult
  isNew: boolean
  inHunt: boolean
  adding: boolean
  /** The full ad is being read for its photos. */
  loadingPhotos?: boolean
}>()
const emit = defineEmits<{ open: []; add: []; hide: []; unhide: []; morePhotos: [] }>()
const { t } = useI18n()

const photos = computed(() => resultPhotos(props.result))
const index = ref(0)
const broken = ref(new Set<string>())

function onScroll(e: Event) {
  const el = e.target as HTMLElement
  index.value = Math.round(el.scrollLeft / Math.max(el.clientWidth, 1))
  if (index.value >= photos.value.length - 1 && !resultDetail(props.result)) emit('morePhotos')
}
</script>

<template>
  <article
    class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    :class="{ 'opacity-60': result.hidden_at }"
    data-testid="search-result"
  >
    <div class="relative bg-slate-100">
      <div
        class="flex aspect-[4/3] snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none]"
        data-testid="result-photos"
        @scroll.passive="onScroll"
      >
        <template v-for="src in photos" :key="src">
          <img
            v-if="!broken.has(src)"
            :src="src"
            alt=""
            referrerpolicy="no-referrer"
            loading="lazy"
            class="h-full w-full shrink-0 snap-center object-cover"
            @click="$emit('open')"
            @error="broken = new Set([...broken, src])"
          />
        </template>
        <button
          v-if="!photos.length"
          type="button"
          class="flex w-full items-center justify-center text-5xl text-slate-300"
          :aria-label="result.title ?? t('listing.untitled')"
          @click="$emit('open')"
        >
          🏠
        </button>
      </div>
      <span
        v-if="isNew"
        class="absolute top-2 left-2 rounded-full bg-brand-700 px-2 py-0.5 text-xs font-semibold text-white"
        >{{ t('browse.new') }}</span
      >
      <span
        v-if="photos.length > 1 || loadingPhotos"
        class="absolute right-2 bottom-2 rounded-full bg-slate-900/60 px-2 py-0.5 text-xs font-semibold text-white"
        data-testid="photo-counter"
      >
        {{ Math.min(index + 1, photos.length) }} / {{ photos.length
        }}<template v-if="loadingPhotos">…</template>
      </span>
    </div>
    <button type="button" class="block w-full text-left" @click="$emit('open')">
      <div class="min-w-0 px-3 py-2">
        <p class="line-clamp-2 text-sm leading-snug font-semibold">
          {{ result.title ?? t('listing.untitled') }}
        </p>
        <p class="mt-0.5">
          <span class="text-lg font-bold text-brand-800">{{ formatPLN(resultTotal(result)) }}</span>
          <span v-if="result.admin_fee" class="ml-1.5 text-xs text-slate-500">
            {{
              t('browse.rentPlusFee', {
                rent: formatPLN(result.rent),
                fee: formatPLN(result.admin_fee),
              })
            }}
          </span>
        </p>
        <p class="text-sm text-slate-600">
          {{ formatArea(result.area_m2) }} ·
          {{ result.rooms ? t('listing.roomsShort', result.rooms) : '—' }}
          <template v-if="result.district"> · {{ result.district }}</template>
        </p>
        <p class="mt-1 flex flex-wrap gap-1 text-xs">
          <span
            v-if="result.private_owner != null"
            class="rounded-full px-2 py-0.5"
            :class="
              result.private_owner
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-slate-100 text-slate-600'
            "
          >
            {{ result.private_owner ? t('form.private') : t('form.agency') }}
          </span>
          <span v-if="inHunt" class="rounded-full bg-sky-100 px-2 py-0.5 text-sky-800">
            ✓ {{ t('browse.inHunt') }}
          </span>
        </p>
      </div>
    </button>
    <div class="flex border-t border-slate-100 text-sm font-semibold">
      <button
        v-if="result.hidden_at"
        type="button"
        class="flex-1 py-2.5 text-slate-600"
        @click="$emit('unhide')"
      >
        {{ t('browse.unhide') }}
      </button>
      <button v-else type="button" class="flex-1 py-2.5 text-slate-500" @click="$emit('hide')">
        {{ t('browse.hide') }}
      </button>
      <button
        type="button"
        class="flex-1 border-l border-slate-100 py-2.5 text-brand-700 disabled:text-slate-400"
        :disabled="inHunt || adding"
        @click="$emit('add')"
      >
        {{ inHunt ? t('browse.added') : adding ? t('browse.adding') : t('browse.add') }}
      </button>
    </div>
  </article>
</template>
