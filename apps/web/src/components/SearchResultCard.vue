<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { formatArea, formatPLN } from '@at/shared'
import { resultTotal, type SearchResult } from '@/lib/browse'

// One ad from a saved Otodom search: just what the results list shows.
defineProps<{
  result: SearchResult
  isNew: boolean
  inHunt: boolean
  adding: boolean
}>()
defineEmits<{ open: []; add: []; hide: []; unhide: [] }>()
const { t } = useI18n()
</script>

<template>
  <article
    class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    :class="{ 'opacity-60': result.hidden_at }"
    data-testid="search-result"
  >
    <button type="button" class="flex w-full gap-3 text-left" @click="$emit('open')">
      <div class="relative h-28 w-32 shrink-0 bg-slate-100">
        <img
          v-if="result.photos[0]"
          :src="result.photos[0]"
          alt=""
          referrerpolicy="no-referrer"
          loading="lazy"
          class="h-full w-full object-cover"
        />
        <span
          v-if="isNew"
          class="absolute top-1.5 left-1.5 rounded-full bg-brand-700 px-2 py-0.5 text-xs font-semibold text-white"
          >{{ t('browse.new') }}</span
        >
      </div>
      <div class="min-w-0 flex-1 py-2 pr-3">
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
