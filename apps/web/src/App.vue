<script setup lang="ts">
import { watch } from 'vue'
import { RouterView } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useNotificationsStore } from '@/stores/notifications'
import UpdateBanner from '@/components/UpdateBanner.vue'

const auth = useAuthStore()
const notifications = useNotificationsStore()

// The notification feed (and its bell badge) follows whoever is signed in.
watch(
  () => auth.userId,
  (id) => {
    if (id) void notifications.start(id).catch(() => {})
    else notifications.stop()
  },
  { immediate: true },
)
</script>

<template>
  <RouterView />
  <UpdateBanner />
</template>
