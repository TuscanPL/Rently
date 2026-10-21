<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Swipe } from '@at/shared'
import { SWIPE_ICONS } from '@/lib/votes'
import { useVotesStore } from '@/stores/votes'
import MemberVotes from './MemberVotes.vue'
import ReconsiderSheet from './ReconsiderSheet.vue'

// The listing detail's Votes section: my swipe, everyone's votes and Reconsider.
const props = defineProps<{ listingId: string }>()
const { t } = useI18n()
const votes = useVotesStore()

const summary = computed(() => votes.summaries[props.listingId] ?? null)
const busy = ref(false)
const error = ref<string | null>(null)
const showReconsider = ref(false)
const reconsiderError = ref<string | null>(null)
const notice = ref<string | null>(null)

const someoneSaidNo = computed(
  () => summary.value?.member_votes.some((v) => v.swipe === 'no') ?? false,
)

const swipeClass: Record<Swipe, string> = {
  no: 'border-rose-300 bg-rose-50 text-rose-700',
  maybe: 'border-amber-300 bg-amber-50 text-amber-700',
  yes: 'border-emerald-300 bg-emerald-50 text-emerald-700',
}
const order: Swipe[] = ['no', 'maybe', 'yes']

async function save(swipe: Swipe) {
  busy.value = true
  error.value = null
  try {
    await votes.setVote(props.listingId, swipe)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function submitReconsider(note: string) {
  busy.value = true
  reconsiderError.value = null
  try {
    const res = await votes.requestReconsider(props.listingId, note)
    showReconsider.value = false
    notice.value = res.cleared_own ? t('reconsider.cleared') : t('reconsider.sent')
  } catch (e) {
    reconsiderError.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section v-if="summary" class="card space-y-4" data-testid="votes">
    <h3 class="font-semibold">{{ t('votes.title') }}</h3>

    <div>
      <p class="label">{{ t('votes.mine') }}</p>
      <div class="grid grid-cols-3 gap-2" role="group" :aria-label="t('votes.mine')">
        <button
          v-for="s in order"
          :key="s"
          type="button"
          class="rounded-xl border px-2 py-2 text-sm font-semibold transition"
          :class="
            summary.my_swipe === s ? swipeClass[s] : 'border-slate-200 bg-white text-slate-600'
          "
          :aria-pressed="summary.my_swipe === s"
          :disabled="busy"
          @click="save(s)"
        >
          {{ SWIPE_ICONS[s] }} {{ t(`votes.swipe.${s}`) }}
        </button>
      </div>
    </div>

    <div class="space-y-2">
      <p class="label">{{ t('votes.everyone') }}</p>
      <MemberVotes :summary="summary" />
      <p v-if="summary.is_match" class="font-semibold text-emerald-700">{{ t('toast.match') }}</p>
    </div>

    <div v-if="someoneSaidNo" class="flex items-center gap-3">
      <span
        v-if="summary.still_no"
        class="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-white"
      >
        {{ t('deck.stillNo') }}
      </span>
      <span v-if="summary.reconsider_pending" class="text-sm text-slate-500">
        {{ t('reconsider.pending') }}
      </span>
      <button v-else type="button" class="btn-secondary" @click="showReconsider = true">
        {{ t('reconsider.button') }}
      </button>
    </div>
    <p v-if="notice" class="text-sm text-brand-800" role="status">{{ notice }}</p>
    <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>

    <ReconsiderSheet
      v-if="showReconsider"
      :busy="busy"
      :error="reconsiderError"
      @submit="submitReconsider"
      @close="showReconsider = false"
    />
  </section>
</template>
