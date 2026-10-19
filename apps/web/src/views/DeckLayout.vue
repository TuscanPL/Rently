<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useVotesStore } from '@/stores/votes'

// The Deck tab: swipe, plus the lists that come out of everyone's votes.
const { t } = useI18n()
const route = useRoute()
const votes = useVotesStore()

const counts = computed(() => {
  const all = Object.values(votes.summaries)
  return {
    deck: null,
    matches: all.filter((s) => s.is_match).length,
    disagreements: all.filter((s) => s.is_disagreement).length,
    maybes: all.filter((s) => s.is_maybe).length,
  }
})
const segments = ['deck', 'matches', 'disagreements', 'maybes'] as const

// Realtime keeps the store fresh; refetch on entry anyway in case an event was missed.
onMounted(() => void votes.refresh().catch(() => {}))
</script>

<template>
  <div class="space-y-3">
    <nav
      class="flex gap-0.5 overflow-x-auto rounded-2xl bg-slate-100 p-1 text-[13px]"
      :aria-label="t('deck.segmentLabel')"
    >
      <RouterLink
        v-for="s in segments"
        :key="s"
        :to="{ name: s, params: { huntId: route.params.huntId } }"
        class="flex flex-auto items-center justify-center gap-1 rounded-xl px-2 py-1.5 font-medium whitespace-nowrap text-slate-600"
        exact-active-class="bg-white !text-slate-900 shadow-sm"
      >
        {{ t(`deck.segments.${s}`) }}
        <span
          v-if="counts[s]"
          class="rounded-full bg-brand-100 px-1.5 text-[11px] leading-4 font-semibold text-brand-800"
          >{{ counts[s] }}</span
        >
      </RouterLink>
    </nav>
    <RouterView />
  </div>
</template>
