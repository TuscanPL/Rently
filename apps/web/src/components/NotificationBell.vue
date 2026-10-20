<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useNotificationsStore } from '@/stores/notifications'

const { t } = useI18n()
const store = useNotificationsStore()
</script>

<template>
  <RouterLink
    :to="{ name: 'notifications' }"
    class="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl hover:bg-slate-100"
    :aria-label="
      store.unreadCount
        ? t('notifications.bellUnread', { n: store.unreadCount })
        : t('notifications.title')
    "
    data-testid="notification-bell"
  >
    <span aria-hidden="true">🔔</span>
    <span
      v-if="store.unreadCount"
      class="absolute top-0.5 right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-xs font-bold text-white"
      data-testid="unread-count"
      aria-hidden="true"
    >
      {{ store.unreadCount > 9 ? '9+' : store.unreadCount }}
    </span>
  </RouterLink>
</template>
