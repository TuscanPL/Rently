<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'

// The List tab: the hunt's own listings, and a saved Otodom search to browse.
const { t } = useI18n()
const route = useRoute()
</script>

<template>
  <div class="space-y-3">
    <nav
      class="grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-semibold"
      data-testid="list-tabs"
    >
      <RouterLink
        v-for="tab in ['list', 'browse'] as const"
        :key="tab"
        :to="{ name: tab, params: { huntId: route.params.huntId } }"
        class="rounded-lg py-2 text-center text-slate-600"
        exact-active-class="bg-white !text-brand-800 shadow-sm"
      >
        {{ t(`browse.tabs.${tab}`) }}
      </RouterLink>
    </nav>
    <RouterView />
  </div>
</template>
