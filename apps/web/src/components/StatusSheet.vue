<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { ListingStatus } from '@at/shared'
import type { ListingWithPhotos } from '@/lib/listings'
import { PIPELINE_COLUMNS, STATUS_CLASSES } from '@/lib/pipeline'
import { fromWarsawInput, toWarsawInput } from '@/lib/time'
import { useViewingIcs } from '@/lib/useViewingIcs'
import { useListingsStore } from '@/stores/listings'

// Bottom sheet for a listing's status: pick a column, and for viewing_booked
// the date and time, then offer the .ics file. `startWith` opens straight on
// that status (a card dropped on a column).
const props = defineProps<{ listing: ListingWithPhotos; startWith?: ListingStatus | null }>()
const emit = defineEmits<{ close: [] }>()
const { t, d } = useI18n()
const listingsStore = useListingsStore()
const downloadViewing = useViewingIcs()

type Step = 'pick' | 'viewing' | 'booked'
const step = ref<Step>('pick')
const when = ref(props.listing.viewing_at ? toWarsawInput(new Date(props.listing.viewing_at)) : '')
const busy = ref(false)
const error = ref<string | null>(null)
const whenInput = ref<HTMLInputElement | null>(null)

// The store copy stays current after saving (and over Realtime).
const current = computed(() => listingsStore.byId(props.listing.id) ?? props.listing)

async function choose(status: ListingStatus) {
  if (status === 'viewing_booked') {
    step.value = 'viewing'
    await nextTick()
    whenInput.value?.focus()
    return
  }
  if (status === current.value.status) return emit('close')
  await save(status)
  if (!error.value) emit('close')
}

async function save(status: ListingStatus, viewingAt?: string) {
  busy.value = true
  error.value = null
  try {
    await listingsStore.setStatus(props.listing.id, status, viewingAt)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function saveViewing() {
  const at = fromWarsawInput(when.value)
  if (!at) return
  await save('viewing_booked', at.toISOString())
  if (!error.value) step.value = 'booked'
}

onMounted(() => {
  if (props.startWith) void choose(props.startWith)
})
</script>

<template>
  <div
    class="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 sm:items-center"
    @click.self="emit('close')"
    @keydown.esc="emit('close')"
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="status-title"
      class="max-h-[90dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl sm:rounded-3xl"
      data-testid="status-sheet"
    >
      <div>
        <h2 id="status-title" class="text-lg font-semibold">
          {{ step === 'pick' ? t('pipeline.moveTo') : t('pipeline.viewingTitle') }}
        </h2>
        <p class="truncate text-sm text-slate-500">
          {{ listing.title ?? t('listing.untitled') }}
        </p>
      </div>

      <template v-if="step === 'pick'">
        <ul class="grid grid-cols-2 gap-2">
          <li v-for="s in PIPELINE_COLUMNS" :key="s">
            <button
              type="button"
              class="flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium"
              :class="
                s === current.status
                  ? 'border-brand-600 ring-2 ring-brand-100'
                  : 'border-slate-200 hover:bg-slate-50'
              "
              :disabled="busy"
              @click="choose(s)"
            >
              <span class="rounded-full px-2 py-0.5" :class="STATUS_CLASSES[s]">
                {{ t(`pipeline.status.${s}`) }}
              </span>
              <span v-if="s === current.status" class="text-xs text-slate-500">
                {{ t('pipeline.current') }}
              </span>
            </button>
          </li>
        </ul>
        <RouterLink
          :to="{ name: 'listing', params: { huntId: listing.hunt_id, listingId: listing.id } }"
          class="btn-secondary w-full"
        >
          {{ t('pipeline.open') }}
        </RouterLink>
      </template>

      <form v-else-if="step === 'viewing'" class="space-y-3" @submit.prevent="saveViewing">
        <div>
          <label class="label" for="viewing-at">{{ t('pipeline.viewingLabel') }}</label>
          <input
            id="viewing-at"
            ref="whenInput"
            v-model="when"
            type="datetime-local"
            required
            class="input"
          />
        </div>
        <div class="flex gap-3">
          <button type="button" class="btn-secondary flex-1" @click="emit('close')">
            {{ t('common.cancel') }}
          </button>
          <button type="submit" class="btn-primary flex-1" :disabled="busy || !when">
            {{ busy ? t('common.saving') : t('pipeline.saveViewing') }}
          </button>
        </div>
      </form>

      <template v-else>
        <p class="rounded-xl bg-violet-50 p-3 text-sm font-medium text-violet-900">
          {{ t('pipeline.viewingAt', { date: d(new Date(current.viewing_at!), 'viewing') }) }}
        </p>
        <div class="flex gap-3">
          <button type="button" class="btn-secondary flex-1" @click="downloadViewing(current)">
            📅 {{ t('pipeline.downloadIcs') }}
          </button>
          <button type="button" class="btn-primary" @click="emit('close')">
            {{ t('listFilters.done') }}
          </button>
        </div>
      </template>

      <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>
    </div>
  </div>
</template>
