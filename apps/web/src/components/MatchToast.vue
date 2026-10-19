<script setup lang="ts">
import { computed, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useListingsStore } from '@/stores/listings'
import { useVotesStore } from '@/stores/votes'

// "It's a match" toasts for the open hunt, fed by matched events over Realtime.
const { t } = useI18n()
const votes = useVotesStore()
const listingsStore = useListingsStore()

const toast = computed(() => votes.toasts[0] ?? null)
const listing = computed(() => (toast.value ? listingsStore.byId(toast.value.listingId) : null))

let timer: ReturnType<typeof setTimeout> | undefined
watch(toast, (current) => {
  clearTimeout(timer)
  if (current) timer = setTimeout(() => votes.dismissToast(current.id), 8000)
})
</script>

<template>
  <Transition
    enter-from-class="-translate-y-4 opacity-0"
    leave-to-class="-translate-y-4 opacity-0"
    enter-active-class="transition duration-300"
    leave-active-class="transition duration-200"
  >
    <div
      v-if="toast"
      :key="toast.id"
      class="fixed inset-x-4 top-[max(0.75rem,env(safe-area-inset-top))] z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-emerald-600 p-3 pl-4 text-white shadow-xl"
      role="status"
      data-testid="match-toast"
    >
      <div class="min-w-0 flex-1">
        <p class="font-bold">{{ t('toast.match') }}</p>
        <p v-if="listing" class="truncate text-sm text-emerald-50">
          {{ listing.title ?? t('listing.untitled') }}
        </p>
      </div>
      <RouterLink
        v-if="listing"
        :to="{ name: 'listing', params: { huntId: listing.hunt_id, listingId: listing.id } }"
        class="rounded-xl bg-white px-3 py-1.5 text-sm font-semibold text-emerald-700"
        @click="votes.dismissToast(toast.id)"
      >
        {{ t('toast.view') }}
      </RouterLink>
      <button
        type="button"
        class="px-1 text-xl leading-none text-emerald-100"
        :aria-label="t('toast.dismiss')"
        @click="votes.dismissToast(toast.id)"
      >
        ×
      </button>
    </div>
  </Transition>
</template>
