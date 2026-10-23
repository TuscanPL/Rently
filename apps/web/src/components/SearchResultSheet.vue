<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatArea, formatPLN, type ParsedListing } from '@at/shared'
import { resultPhotos, resultTotal, type SearchResult } from '@/lib/browse'
import { loadResultDetail } from '@/lib/browseApi'
import { useScrollLock } from '@/lib/useScrollLock'

// A closer look at an ad from the results without leaving the app. It opens
// with what the results list had and loads the full ad (description, all
// photos, deposit, features) from Otodom the first time anyone opens it.
const props = defineProps<{ result: SearchResult; inHunt: boolean; adding: boolean }>()
const emit = defineEmits<{
  close: []
  add: [liked: boolean]
  detail: [detail: ParsedListing]
}>()
const { t, d } = useI18n()
const broken = ref(new Set<number>())
const loading = ref(false)
const loadError = ref<string | null>(null)
const showFull = ref(false)
useScrollLock()

const detail = computed(() => props.result.detail as ParsedListing | null)
const photos = computed(() => resultPhotos(props.result))
const rent = computed(() => detail.value?.rent ?? props.result.rent)
const adminFee = computed(() => detail.value?.adminFee ?? props.result.admin_fee)
const description = computed(() => {
  const text = detail.value?.description ?? ''
  return showFull.value || text.length <= 400 ? text : `${text.slice(0, 400)}…`
})
const floor = computed(() => {
  const f = detail.value?.floor ?? props.result.floor
  const of = detail.value?.totalFloors
  return f == null ? '—' : of != null ? `${f} / ${of}` : String(f)
})
const extras = computed(() => {
  const l = detail.value
  if (!l) return []
  const yesNo = (v: boolean | undefined) => (v == null ? null : v ? t('form.yes') : t('form.no'))
  const f = l.features ?? {}
  return [
    [t('form.deposit'), l.deposit != null ? formatPLN(l.deposit) : null],
    [t('form.availableFrom'), l.availableFrom && d(new Date(l.availableFrom), 'short')],
    [t('features.petsAllowed'), yesNo(f.petsAllowed)],
    [t('features.furnished'), yesNo(f.furnished)],
    [t('features.balcony'), yesNo(f.balcony)],
    [t('features.elevator'), yesNo(f.elevator)],
    [t('features.parking'), yesNo(f.parking)],
    [t('features.yearBuilt'), f.yearBuilt],
    [t('features.heating'), f.heating],
  ].filter(([, v]) => v != null && v !== '') as [string, string | number][]
})

onMounted(async () => {
  if (detail.value) return
  loading.value = true
  try {
    emit('detail', await loadResultDetail(props.result))
  } catch (e) {
    loadError.value = (e as Error).message
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div
    class="fixed inset-0 z-[1500] flex touch-none items-end overscroll-none bg-slate-900/50 md:items-center md:justify-center"
    @click.self="$emit('close')"
  >
    <div
      class="max-h-[92dvh] w-full touch-auto overflow-y-auto overscroll-contain rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] md:max-w-lg md:rounded-3xl"
      role="dialog"
      aria-modal="true"
      :aria-label="result.title ?? t('listing.untitled')"
      data-testid="search-sheet"
    >
      <div
        class="flex snap-x snap-mandatory gap-1 overflow-x-auto overscroll-x-contain bg-slate-100"
      >
        <template v-for="(src, i) in photos" :key="src">
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
          v-if="!photos.length"
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
        <p class="text-2xl font-bold text-brand-800">
          {{ formatPLN(resultTotal({ rent, admin_fee: adminFee })) }}
        </p>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt class="text-slate-500">{{ t('form.rent') }}</dt>
          <dd>{{ formatPLN(rent) }}</dd>
          <dt class="text-slate-500">{{ t('form.adminFee') }}</dt>
          <dd>{{ formatPLN(adminFee) }}</dd>
          <dt class="text-slate-500">{{ t('form.areaM2') }}</dt>
          <dd>{{ formatArea(result.area_m2) }}</dd>
          <dt class="text-slate-500">{{ t('form.rooms') }}</dt>
          <dd>{{ result.rooms ?? '—' }}</dd>
          <dt class="text-slate-500">{{ t('form.floor') }}</dt>
          <dd>{{ floor }}</dd>
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
          <template v-for="[label, value] in extras" :key="label">
            <dt class="text-slate-500">{{ label }}</dt>
            <dd>{{ value }}</dd>
          </template>
        </dl>
        <p v-if="loading" class="text-sm text-slate-500" data-testid="detail-loading">
          {{ t('browse.loadingAd') }}
        </p>
        <p v-else-if="loadError" class="text-sm text-rose-700" data-testid="detail-error">
          {{ t('browse.adError', { error: loadError }) }}
        </p>
        <div v-if="description" data-testid="detail-description">
          <p class="text-sm whitespace-pre-line text-slate-700">{{ description }}</p>
          <button
            v-if="(detail?.description?.length ?? 0) > 400"
            type="button"
            class="mt-1 text-sm font-semibold text-brand-700"
            @click="showFull = !showFull"
          >
            {{ showFull ? t('listing.showLess') : t('listing.showMore') }}
          </button>
        </div>
        <p class="text-xs text-slate-500">{{ t('browse.sheetHelp') }}</p>
        <div class="flex gap-3">
          <template v-if="inHunt || adding">
            <button type="button" class="btn-primary flex-1" disabled>
              {{ inHunt ? t('browse.added') : t('browse.adding') }}
            </button>
          </template>
          <template v-else>
            <button type="button" class="btn-secondary flex-1" @click="$emit('add', false)">
              {{ t('browse.add') }}
            </button>
            <button type="button" class="btn-primary flex-1" @click="$emit('add', true)">
              ♥ {{ t('browse.addLiked') }}
            </button>
          </template>
        </div>
        <a
          :href="result.url"
          target="_blank"
          rel="noopener noreferrer"
          class="block text-center text-sm font-semibold text-brand-700"
        >
          {{ t('browse.openOtodom') }} ↗
        </a>
      </div>
    </div>
  </div>
</template>
