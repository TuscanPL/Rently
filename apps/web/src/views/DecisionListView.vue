<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ListingSummary } from '@/lib/votes'
import type { ListingWithPhotos } from '@/lib/listings'
import { useListingsStore } from '@/stores/listings'
import { useVotesStore } from '@/stores/votes'
import ListingCard from '@/components/ListingCard.vue'
import MemberVotes from '@/components/MemberVotes.vue'
import ReconsiderSheet from '@/components/ReconsiderSheet.vue'

// Matches, disagreements and maybes, newest first.
const props = defineProps<{ kind: 'matches' | 'disagreements' | 'maybes' }>()
const { t } = useI18n()
const listingsStore = useListingsStore()
const votes = useVotesStore()

const reconsiderFor = ref<string | null>(null)
const reconsiderBusy = ref(false)
const reconsiderError = ref<string | null>(null)

const flag = { matches: 'is_match', disagreements: 'is_disagreement', maybes: 'is_maybe' } as const

const items = computed(() => {
  const rows: { listing: ListingWithPhotos; summary: ListingSummary }[] = []
  for (const listing of listingsStore.listings) {
    const summary = votes.summaries[listing.id]
    if (summary?.[flag[props.kind]]) rows.push({ listing, summary })
  }
  return rows
})

const someoneSaidNo = (s: ListingSummary) => s.member_votes.some((v) => v.swipe === 'no')

async function submitReconsider(note: string) {
  if (!reconsiderFor.value) return
  reconsiderBusy.value = true
  reconsiderError.value = null
  try {
    await votes.requestReconsider(reconsiderFor.value, note)
    reconsiderFor.value = null
  } catch (e) {
    reconsiderError.value = (e as Error).message
  } finally {
    reconsiderBusy.value = false
  }
}
</script>

<template>
  <div class="space-y-3" :data-testid="`${kind}-list`">
    <p v-if="!items.length" class="card mt-6 text-center text-slate-600">
      {{ t(`${kind}.empty`) }}
    </p>
    <div v-for="{ listing, summary } in items" :key="listing.id" class="space-y-2">
      <ListingCard :listing="listing">
        <p class="mt-1 flex flex-wrap items-center gap-1.5 text-xs empty:hidden">
          <span
            v-if="summary.still_no"
            class="rounded-full bg-slate-800 px-2 py-0.5 font-semibold text-white"
          >
            {{ t('deck.stillNo') }}
          </span>
        </p>
      </ListingCard>
      <div class="flex items-center gap-2 px-1">
        <div class="min-w-0 flex-1"><MemberVotes :summary="summary" /></div>
        <template v-if="someoneSaidNo(summary)">
          <span v-if="summary.reconsider_pending" class="shrink-0 text-xs text-slate-500">
            {{ t('reconsider.pending') }}
          </span>
          <button
            v-else
            type="button"
            class="btn-secondary shrink-0 px-3 py-1.5"
            @click="reconsiderFor = listing.id"
          >
            {{ t('reconsider.button') }}
          </button>
        </template>
      </div>
    </div>

    <ReconsiderSheet
      v-if="reconsiderFor"
      :busy="reconsiderBusy"
      :error="reconsiderError"
      @submit="submitReconsider"
      @close="reconsiderFor = null"
    />
  </div>
</template>
