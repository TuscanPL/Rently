<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { SWIPE_ICONS, type ListingSummary } from '@/lib/votes'

// Each member's swipe and stars. Other members' stars stay hidden until everyone has voted.
defineProps<{ summary: ListingSummary }>()
const { t } = useI18n()

const swipeClass = {
  yes: 'bg-emerald-100 text-emerald-800',
  maybe: 'bg-amber-100 text-amber-800',
  no: 'bg-rose-100 text-rose-800',
} as const
</script>

<template>
  <ul class="flex flex-wrap gap-1.5 text-sm" data-testid="member-votes">
    <li
      v-for="v in summary.member_votes"
      :key="v.user_id"
      class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5"
      :class="v.swipe ? swipeClass[v.swipe] : 'bg-slate-100 text-slate-500'"
    >
      <span class="font-medium">{{ v.display_name }}</span>
      <span v-if="v.swipe">{{ SWIPE_ICONS[v.swipe] }} {{ t(`votes.swipe.${v.swipe}`) }}</span>
      <span v-else>{{ t('votes.notYet') }}</span>
      <span v-if="v.stars" class="text-amber-600">★{{ v.stars }}</span>
    </li>
  </ul>
</template>
