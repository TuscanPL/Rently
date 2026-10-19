<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { costPerM2, formatArea, formatPLN, type ListingFeatures } from '@at/shared'
import { supabase, type Tables } from '@/lib/supabase'
import { listingTotal, SOURCE_LABELS, sortedPhotos, type ListingWithPhotos } from '@/lib/listings'
import { useListingsStore } from '@/stores/listings'
import ListingImage from '@/components/ListingImage.vue'

type EventRow = Tables<'listing_events'> & { profiles: { display_name: string } | null }

const { t, d } = useI18n()
const route = useRoute()
const router = useRouter()
const listingsStore = useListingsStore()

const listing = ref<ListingWithPhotos | null>(null)
const history = ref<Tables<'listing_price_history'>[]>([])
const events = ref<EventRow[]>([])
const error = ref<string | null>(null)
const loaded = ref(false)
const showFullDescription = ref(false)

const listingId = computed(() => route.params.listingId as string)
const huntId = computed(() => route.params.huntId as string)
const photos = computed(() => sortedPhotos(listing.value?.listing_photos ?? []))
const cover = computed(() => photos.value.find((p) => p.is_cover) ?? null)
const perM2 = computed(() => {
  const l = listing.value
  return l
    ? costPerM2({
        rent: l.rent,
        adminFee: l.admin_fee,
        utilitiesEstimate: l.utilities_estimate,
        areaM2: l.area_m2,
      })
    : null
})
const features = computed(() => (listing.value?.features ?? {}) as ListingFeatures)
const ingestInfo = computed(() =>
  listingsStore.lastIngest?.listingId === listingId.value ? listingsStore.lastIngest : null,
)

async function load() {
  error.value = null
  const [l, h, e] = await Promise.all([
    supabase
      .from('listings')
      .select('*, listing_photos(*)')
      .eq('id', listingId.value)
      .maybeSingle(),
    supabase
      .from('listing_price_history')
      .select('*')
      .eq('listing_id', listingId.value)
      .order('observed_at'),
    supabase
      .from('listing_events')
      .select('*, profiles(display_name)')
      .eq('listing_id', listingId.value)
      .order('created_at', { ascending: false }),
  ])
  if (l.error) error.value = l.error.message
  listing.value = l.data
  history.value = h.data ?? []
  events.value = (e.data ?? []) as EventRow[]
  loaded.value = true
}

watch(listingId, load, { immediate: true })

const facts = computed(() => {
  const l = listing.value
  if (!l) return []
  const yesNo = (v: boolean | undefined) => (v == null ? null : v ? t('form.yes') : t('form.no'))
  const floor =
    l.floor == null
      ? null
      : l.total_floors != null
        ? `${l.floor} / ${l.total_floors}`
        : String(l.floor)
  return [
    [t('form.areaM2'), formatArea(l.area_m2)],
    [t('form.rooms'), l.rooms],
    [t('form.floor'), floor],
    [t('form.availableFrom'), l.available_from && d(new Date(l.available_from), 'short')],
    [
      t('form.advertiserType'),
      l.advertiser_type !== 'unknown' ? t(`form.${l.advertiser_type}`) : null,
    ],
    [t('features.petsAllowed'), yesNo(features.value.petsAllowed)],
    [t('features.furnished'), yesNo(features.value.furnished)],
    [t('features.balcony'), yesNo(features.value.balcony)],
    [t('features.elevator'), yesNo(features.value.elevator)],
    [t('features.parking'), yesNo(features.value.parking)],
    [t('features.yearBuilt'), features.value.yearBuilt],
    [t('features.heating'), features.value.heating],
  ].filter(([, v]) => v != null && v !== '') as [string, string | number][]
})

const description = computed(() => {
  const text = listing.value?.description ?? ''
  return showFullDescription.value || text.length <= 400 ? text : `${text.slice(0, 400)}…`
})

function dismissIngestInfo() {
  listingsStore.lastIngest = null
}

async function remove() {
  if (!confirm(t('listing.deleteConfirm'))) return
  const { error: err } = await supabase.from('listings').delete().eq('id', listingId.value)
  if (err) {
    error.value = err.message
    return
  }
  dismissIngestInfo()
  await router.replace({ name: 'list', params: { huntId: huntId.value } })
}

function eventText(e: EventRow) {
  const who = e.profiles?.display_name ?? t('listing.someone')
  const payload = (e.payload ?? {}) as { fields?: string[] }
  return t(
    `events.${e.type}`,
    { who, fields: payload.fields?.join(', ') ?? '' },
    { default: `${who}: ${e.type}` },
  )
}
</script>

<template>
  <p v-if="!loaded" class="text-slate-500">{{ t('common.loading') }}</p>
  <p v-else-if="!listing" class="card text-slate-600">{{ error ?? t('listing.notFound') }}</p>

  <article v-else class="-mx-4 -mt-4 space-y-5 pb-6">
    <div
      class="flex snap-x snap-mandatory gap-1 overflow-x-auto bg-slate-100"
      data-testid="gallery"
    >
      <div
        v-for="p in photos.length ? photos : [null]"
        :key="p?.id ?? 'placeholder'"
        class="aspect-[4/3] w-full shrink-0 snap-center sm:w-2/3"
      >
        <ListingImage :photo="p" :cover="cover" :alt="listing.title ?? ''" />
      </div>
    </div>

    <div class="space-y-5 px-4">
      <div
        v-if="ingestInfo?.existing"
        class="rounded-xl bg-sky-50 p-3 text-sm text-sky-800"
        role="status"
      >
        {{ t('listing.alreadyAdded') }}
        <button type="button" class="ml-2 underline" @click="dismissIngestInfo">
          {{ t('listing.ok') }}
        </button>
      </div>
      <div
        v-else-if="ingestInfo?.possibleDuplicates.length"
        class="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"
        role="alert"
        data-testid="duplicate-prompt"
      >
        <p>
          {{ t('listing.duplicateOf') }}
          <RouterLink
            v-for="dup in ingestInfo.possibleDuplicates"
            :key="dup.id"
            :to="{ name: 'listing', params: { huntId, listingId: dup.id } }"
            class="font-semibold underline"
          >
            {{ dup.title ?? t('listing.untitled') }}
          </RouterLink>
        </p>
        <div class="flex gap-3">
          <button type="button" class="btn-danger py-1.5" @click="remove">
            {{ t('listing.deleteThisOne') }}
          </button>
          <button type="button" class="btn-secondary py-1.5" @click="dismissIngestInfo">
            {{ t('listing.keepBoth') }}
          </button>
        </div>
      </div>

      <div
        v-if="listing.needs_details"
        class="flex items-center gap-3 rounded-xl bg-amber-100 p-3 text-sm text-amber-900"
        data-testid="needs-details"
      >
        <span class="flex-1">{{ t('listing.needsDetailsHelp') }}</span>
        <RouterLink
          :to="{ name: 'listing-edit', params: { huntId, listingId } }"
          class="btn-primary py-1.5"
        >
          {{ t('listing.addDetails') }}
        </RouterLink>
      </div>
      <p v-if="!listing.is_active" class="rounded-xl bg-slate-200 p-3 text-sm text-slate-700">
        {{ t('listing.adRemovedHelp') }}
      </p>

      <header>
        <h2 class="text-xl leading-tight font-bold">
          {{ listing.title ?? t('listing.untitled') }}
        </h2>
        <p v-if="listing.address || listing.district" class="mt-1 text-slate-600">
          {{ listing.address || listing.district }}
        </p>
      </header>

      <section class="card" data-testid="costs">
        <p class="text-sm text-slate-500">{{ t('listing.totalMonthly') }}</p>
        <p class="text-3xl font-bold text-brand-800">{{ formatPLN(listingTotal(listing)) }}</p>
        <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt class="text-slate-500">{{ t('form.rent') }}</dt>
          <dd class="text-right">{{ formatPLN(listing.rent) }}</dd>
          <dt class="text-slate-500">{{ t('form.adminFee') }}</dt>
          <dd class="text-right">{{ formatPLN(listing.admin_fee) }}</dd>
          <dt class="text-slate-500">{{ t('form.utilitiesEstimate') }}</dt>
          <dd class="text-right">{{ formatPLN(listing.utilities_estimate) }}</dd>
          <dt class="text-slate-500">{{ t('form.deposit') }}</dt>
          <dd class="text-right">{{ formatPLN(listing.deposit) }}</dd>
          <template v-if="perM2 != null">
            <dt class="text-slate-500">{{ t('listing.perM2') }}</dt>
            <dd class="text-right">{{ formatPLN(perM2) }}</dd>
          </template>
        </dl>
      </section>

      <section v-if="facts.length" class="card">
        <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm" data-testid="facts">
          <template v-for="[label, value] in facts" :key="label">
            <dt class="text-slate-500">{{ label }}</dt>
            <dd class="font-medium">{{ value }}</dd>
          </template>
        </dl>
      </section>

      <section v-if="listing.description" class="card">
        <p class="text-sm whitespace-pre-line text-slate-700">{{ description }}</p>
        <button
          v-if="listing.description.length > 400"
          type="button"
          class="mt-2 text-sm text-brand-700"
          @click="showFullDescription = !showFullDescription"
        >
          {{ showFullDescription ? t('listing.showLess') : t('listing.showMore') }}
        </button>
      </section>

      <div class="flex flex-wrap gap-3">
        <a
          v-if="listing.url"
          :href="listing.url"
          target="_blank"
          rel="noopener noreferrer"
          class="btn-secondary"
        >
          {{ t('listing.openOriginal', { source: SOURCE_LABELS[listing.source] }) }} ↗
        </a>
        <RouterLink
          :to="{ name: 'listing-edit', params: { huntId, listingId } }"
          class="btn-secondary"
        >
          {{ t('listing.edit') }}
        </RouterLink>
      </div>

      <section v-if="history.length > 1" class="card">
        <h3 class="mb-2 font-semibold">{{ t('listing.priceHistory') }}</h3>
        <ul class="space-y-1 text-sm">
          <li v-for="h in history" :key="h.id" class="flex justify-between">
            <span class="text-slate-500">{{ d(new Date(h.observed_at), 'short') }}</span>
            <span>{{ formatPLN(h.rent) }} + {{ formatPLN(h.admin_fee) }}</span>
          </li>
        </ul>
      </section>

      <section v-if="events.length" class="card">
        <h3 class="mb-2 font-semibold">{{ t('listing.timeline') }}</h3>
        <ol class="space-y-2 text-sm">
          <li v-for="e in events" :key="e.id" class="flex gap-3">
            <span class="w-24 shrink-0 text-slate-500">{{
              d(new Date(e.created_at), 'short')
            }}</span>
            <span>{{ eventText(e) }}</span>
          </li>
        </ol>
      </section>

      <button type="button" class="btn-danger w-full" @click="remove">
        {{ t('listing.delete') }}
      </button>
      <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>
    </div>
  </article>
</template>
