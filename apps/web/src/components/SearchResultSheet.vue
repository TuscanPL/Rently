<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatArea, formatPLN } from '@at/shared'
import { resultTotal, type SearchResult } from '@/lib/browse'

// A closer look at an ad from the results without leaving the app: every
// photo the results list has, the numbers, and Add / Open on Otodom.
defineProps<{ result: SearchResult; inHunt: boolean; adding: boolean }>()
defineEmits<{ close: []; add: [] }>()
const { t, d } = useI18n()
const broken = ref(new Set<number>())
</script>

<template>
  <div
    class="fixed inset-0 z-[1500] flex items-end bg-slate-900/50 md:items-center md:justify-center"
    @click.self="$emit('close')"
  >
    <div
      class="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] md:max-w-lg md:rounded-3xl"
      role="dialog"
      aria-modal="true"
      :aria-label="result.title ?? t('listing.untitled')"
      data-testid="search-sheet"
    >
      <div class="flex snap-x snap-mandatory gap-1 overflow-x-auto bg-slate-100">
        <template v-for="(src, i) in result.photos" :key="src">
          <img
            v-if="!broken.has(i)"
            :src="src"
            alt=""
            referrerpolicy="no-referrer"
            loading="lazy"
            class="aspect-[4/3] w-full shrink-0 snap-center object-cover"
            @error="broken = new Set([...broken, i])"
          />
        </template>
        <div
          v-if="!result.photos.length"
          class="flex aspect-[4/3] w-full items-center justify-center text-5xl text-slate-300"
        >
          🏠
        </div>
      </div>
      <div class="space-y-3 p-4">
        <div class="flex items-start gap-3">
          <h2 class="flex-1 text-lg leading-snug font-bold">
            {{ result.title ?? t('listing.untitled') }}
          </h2>
          <button
            type="button"
            class="text-2xl leading-none text-slate-400"
            :aria-label="t('map.close')"
            @click="$emit('close')"
          >
            ×
          </button>
        </div>
        <p v-if="result.address || result.district" class="text-sm text-slate-600">
          {{ [result.address, result.district].filter(Boolean).join(' · ') }}
        </p>
        <p class="text-2xl font-bold text-brand-800">{{ formatPLN(resultTotal(result)) }}</p>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt class="text-slate-500">{{ t('form.rent') }}</dt>
          <dd>{{ formatPLN(result.rent) }}</dd>
          <dt class="text-slate-500">{{ t('form.adminFee') }}</dt>
          <dd>{{ formatPLN(result.admin_fee) }}</dd>
          <dt class="text-slate-500">{{ t('form.areaM2') }}</dt>
          <dd>{{ formatArea(result.area_m2) }}</dd>
          <dt class="text-slate-500">{{ t('form.rooms') }}</dt>
          <dd>{{ result.rooms ?? '—' }}</dd>
          <dt class="text-slate-500">{{ t('form.floor') }}</dt>
          <dd>{{ result.floor ?? '—' }}</dd>
          <dt class="text-slate-500">{{ t('form.advertiserType') }}</dt>
          <dd>
            {{
              result.private_owner == null
                ? '—'
                : result.private_owner
                  ? t('form.private')
                  : t('form.agency')
            }}
          </dd>
          <template v-if="result.posted_at">
            <dt class="text-slate-500">{{ t('browse.listed') }}</dt>
            <dd>{{ d(new Date(result.posted_at), 'short') }}</dd>
          </template>
        </dl>
        <p class="text-xs text-slate-500">{{ t('browse.sheetHelp') }}</p>
        <div class="flex gap-3">
          <a
            :href="result.url"
            target="_blank"
            rel="noopener noreferrer"
            class="btn-secondary flex-1"
          >
            {{ t('browse.openOtodom') }} ↗
          </a>
          <button
            type="button"
            class="btn-primary flex-1"
            :disabled="inHunt || adding"
            @click="$emit('add')"
          >
            {{ inHunt ? t('browse.added') : adding ? t('browse.adding') : t('browse.add') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
