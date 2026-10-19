<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useListingsStore } from '@/stores/listings'
import ListingCard from '@/components/ListingCard.vue'

// Milestone 2: newest first. Sorting and filters arrive in milestone 4.
const { t } = useI18n()
const route = useRoute()
const listingsStore = useListingsStore()
</script>

<template>
  <div class="space-y-3">
    <p v-if="listingsStore.loading" class="text-slate-500">{{ t('common.loading') }}</p>
    <div
      v-else-if="listingsStore.listings.length === 0"
      class="card mt-6 space-y-3 text-center text-slate-600"
    >
      <p class="text-4xl">🏠</p>
      <p>{{ t('list.empty') }}</p>
      <RouterLink
        :to="{ name: 'add', params: { huntId: route.params.huntId } }"
        class="btn-primary"
      >
        {{ t('add.title') }}
      </RouterLink>
    </div>
    <ListingCard v-for="l in listingsStore.listings" :key="l.id" :listing="l" />
  </div>
</template>
