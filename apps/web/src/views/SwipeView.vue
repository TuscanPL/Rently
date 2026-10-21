<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { Swipe } from '@at/shared'
import type { DeckCard } from '@/lib/votes'
import { useListingsStore } from '@/stores/listings'
import { useVotesStore } from '@/stores/votes'
import SwipeCard from '@/components/SwipeCard.vue'
import ReconsiderSheet from '@/components/ReconsiderSheet.vue'

const { t } = useI18n()
const route = useRoute()
const huntId = computed(() => route.params.huntId as string)
const listingsStore = useListingsStore()
const votes = useVotesStore()

const top = ref<InstanceType<typeof SwipeCard> | null>(null)
const error = ref<string | null>(null)
const reconsiderFor = ref<string | null>(null)
const reconsiderBusy = ref(false)
const reconsiderError = ref<string | null>(null)
const notice = ref<string | null>(null)

// Deck rows only carry ids; the listings store already has every listing with photos.
// A card for a listing that's still loading shows up once the store catches up.
const cards = computed<DeckCard[]>(() => {
  const byId = new Map(listingsStore.listings.map((l) => [l.id, l]))
  return votes.deck.flatMap((e) => {
    const listing = byId.get(e.listing_id)
    return listing ? [{ ...e, listing }] : []
  })
})
const visible = computed(() => cards.value.slice(0, 2).reverse())
const topCard = computed(() => cards.value[0] ?? null)

async function onSwipe(card: DeckCard, swipe: Swipe) {
  error.value = null
  notice.value = null
  try {
    await votes.swipeCard(card, swipe)
  } catch (e) {
    error.value = (e as Error).message
  }
}

function setTop(card: DeckCard, el: unknown) {
  if (el && card.listing_id === topCard.value?.listing_id) {
    top.value = el as InstanceType<typeof SwipeCard>
  }
}

function press(swipe: Swipe) {
  top.value?.fling(swipe)
}

async function undo() {
  error.value = null
  try {
    await votes.undo()
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function submitReconsider(note: string) {
  if (!reconsiderFor.value) return
  reconsiderBusy.value = true
  reconsiderError.value = null
  try {
    await votes.requestReconsider(reconsiderFor.value, note)
    reconsiderFor.value = null
    notice.value = t('reconsider.sent')
  } catch (e) {
    reconsiderError.value = (e as Error).message
  } finally {
    reconsiderBusy.value = false
  }
}

function onKey(e: KeyboardEvent) {
  if (reconsiderFor.value || e.altKey || e.defaultPrevented) return
  if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    void undo()
    return
  }
  if (e.ctrlKey || e.metaKey || !topCard.value) return
  const swipe = ({ ArrowRight: 'yes', ArrowLeft: 'no', ArrowUp: 'maybe' } as const)[
    e.key as 'ArrowRight' | 'ArrowLeft' | 'ArrowUp'
  ]
  if (swipe) {
    e.preventDefault()
    press(swipe)
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="space-y-3">
    <div
      class="relative mx-auto h-[calc(100dvh-19rem)] max-h-[42rem] min-h-[24rem] w-full max-w-md"
    >
      <SwipeCard
        v-for="card in visible"
        :key="card.listing_id"
        :ref="(el) => setTop(card, el)"
        :card="card"
        :interactive="card === topCard"
        :class="card === topCard ? 'z-10' : 'translate-y-3 scale-95 opacity-90'"
        :aria-hidden="card !== topCard"
        :data-testid="card === topCard ? 'deck-card' : undefined"
        @swipe="(s) => onSwipe(card, s)"
        @reconsider="reconsiderFor = card.listing_id"
      />

      <div
        v-if="votes.deckLoaded && !cards.length"
        class="card absolute inset-0 flex flex-col items-center justify-center gap-3 text-center text-slate-600"
        data-testid="deck-empty"
      >
        <p class="text-5xl">🏠</p>
        <p class="text-lg font-semibold text-slate-900">{{ t('deck.empty.title') }}</p>
        <p v-if="listingsStore.listings.length">{{ t('deck.empty.allVoted') }}</p>
        <p v-else>{{ t('deck.empty.noListings') }}</p>
        <div class="flex flex-wrap justify-center gap-2">
          <RouterLink
            v-if="listingsStore.listings.length"
            :to="{ name: 'matches', params: { huntId } }"
            class="btn-secondary"
          >
            {{ t('deck.empty.seeMatches') }}
          </RouterLink>
          <RouterLink :to="{ name: 'add', params: { huntId } }" class="btn-primary">
            {{ t('add.title') }}
          </RouterLink>
        </div>
      </div>
      <p v-else-if="!votes.deckLoaded" class="pt-10 text-center text-slate-500">
        {{ t('common.loading') }}
      </p>
    </div>

    <div class="flex items-center justify-center gap-3" data-testid="deck-controls">
      <button
        type="button"
        class="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-xl text-slate-600 shadow-sm disabled:opacity-40"
        :disabled="!votes.undoStack.length"
        :aria-label="t('deck.undo')"
        :title="t('deck.undo')"
        @click="undo"
      >
        ↺
      </button>
      <button
        type="button"
        class="flex h-16 w-16 items-center justify-center rounded-full border border-rose-100 bg-white text-3xl text-rose-600 shadow-md transition active:scale-90 disabled:opacity-40"
        :disabled="!topCard"
        :aria-label="t('deck.no')"
        :title="t('deck.no')"
        @click="press('no')"
      >
        ✗
      </button>
      <button
        type="button"
        class="flex h-12 w-12 items-center justify-center rounded-full border border-amber-100 bg-white text-2xl font-bold text-amber-500 shadow-md transition active:scale-90 disabled:opacity-40"
        :disabled="!topCard"
        :aria-label="t('deck.maybe')"
        :title="t('deck.maybe')"
        @click="press('maybe')"
      >
        ?
      </button>
      <button
        type="button"
        class="flex h-16 w-16 items-center justify-center rounded-full border border-emerald-100 bg-white text-3xl text-emerald-600 shadow-md transition active:scale-90 disabled:opacity-40"
        :disabled="!topCard"
        :aria-label="t('deck.yes')"
        :title="t('deck.yes')"
        @click="press('yes')"
      >
        ✓
      </button>
      <RouterLink
        :to="{ name: 'add', params: { huntId } }"
        class="flex h-11 w-11 items-center justify-center rounded-full bg-brand-700 text-2xl text-white shadow-sm"
        :aria-label="t('add.title')"
        :title="t('add.title')"
        data-testid="deck-add"
      >
        ＋
      </RouterLink>
    </div>
    <p v-if="notice" class="text-center text-sm text-brand-800" role="status">{{ notice }}</p>
    <p v-if="error" class="text-center text-sm text-rose-700" role="alert">{{ error }}</p>
    <p class="hidden text-center text-xs text-slate-400 md:block">{{ t('deck.keyboardHint') }}</p>

    <ReconsiderSheet
      v-if="reconsiderFor"
      :busy="reconsiderBusy"
      :error="reconsiderError"
      @submit="submitReconsider"
      @close="reconsiderFor = null"
    />
  </div>
</template>
