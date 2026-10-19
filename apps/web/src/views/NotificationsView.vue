<script setup lang="ts">
import { RouterLink, useRouter, type RouteLocationRaw } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { formatPLN, type NotificationKind } from '@at/shared'
import { useNotificationsStore, type AppNotification } from '@/stores/notifications'

const { t, d } = useI18n()
const router = useRouter()
const store = useNotificationsStore()

const ICONS: Record<NotificationKind, string> = {
  match: '🏠',
  listing_added: '➕',
  reconsider_request: '🔁',
  status_changed: '📋',
  ad_removed: '🚫',
  price_dropped: '📉',
}

interface Snapshot {
  actor_name?: string | null
  listing_title?: string | null
  to?: string | null
  note?: string | null
  total_before?: number | null
  total_after?: number | null
}

function text(n: AppNotification) {
  const p = (n.payload ?? {}) as Snapshot
  return t(`notifications.text.${n.kind}`, {
    actor: p.actor_name || t('notifications.someone'),
    listing: p.listing_title || t('listing.untitled'),
    status: p.to ? t(`notifications.status.${p.to}`) : '',
    before: formatPLN(p.total_before),
    after: formatPLN(p.total_after),
  })
}

const note = (n: AppNotification) => (n.payload as Snapshot | null)?.note ?? null

function target(n: AppNotification): RouteLocationRaw {
  // Reconsider requests are answered in the deck, where the listing is pinned on top.
  if (n.kind === 'reconsider_request' || !n.listing_id) {
    return { name: 'deck', params: { huntId: n.hunt_id } }
  }
  return { name: 'listing', params: { huntId: n.hunt_id, listingId: n.listing_id } }
}

async function open(n: AppNotification) {
  void store.markRead([n.id]).catch(() => {})
  await router.push(target(n))
}

function back() {
  if (window.history.state?.back) router.back()
  else void router.push({ name: 'hunts' })
}
</script>

<template>
  <main class="mx-auto max-w-lg px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-10">
    <button type="button" class="text-sm text-brand-700" @click="back">
      ‹ {{ t('common.back') }}
    </button>
    <header class="mt-2 mb-4 flex items-center justify-between gap-3">
      <h1 class="text-2xl font-bold">{{ t('notifications.title') }}</h1>
      <button
        v-if="store.unreadCount"
        type="button"
        class="btn-secondary py-1.5"
        @click="store.markAllRead()"
      >
        {{ t('notifications.markAllRead') }}
      </button>
    </header>

    <p v-if="!store.loaded" class="text-slate-500">{{ t('common.loading') }}</p>
    <p v-else-if="store.items.length === 0" class="card text-slate-600" data-testid="feed-empty">
      {{ t('notifications.empty') }}
    </p>
    <ul
      v-else
      class="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white"
      data-testid="notification-feed"
    >
      <li v-for="n in store.items" :key="n.id">
        <button
          type="button"
          class="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50"
          :class="{ 'bg-brand-50/60': !n.read_at }"
          data-testid="notification"
          :data-unread="!n.read_at || undefined"
          @click="open(n)"
        >
          <span class="mt-0.5 text-xl" aria-hidden="true">{{ ICONS[n.kind] }}</span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm" :class="n.read_at ? 'text-slate-700' : 'font-semibold'">
              {{ text(n) }}
            </span>
            <span v-if="note(n)" class="mt-0.5 block truncate text-sm text-slate-600 italic">
              “{{ note(n) }}”
            </span>
            <span class="mt-0.5 block text-xs text-slate-500">
              {{ n.hunts?.name ?? '' }}{{ n.hunts ? ' · ' : '' }}{{ d(n.created_at, 'long') }}
            </span>
          </span>
          <span
            v-if="!n.read_at"
            class="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-600"
            :aria-label="t('notifications.unread')"
          />
        </button>
      </li>
    </ul>

    <RouterLink :to="{ name: 'account' }" class="mt-6 block text-center text-sm text-brand-700">
      {{ t('notifications.settingsLink') }}
    </RouterLink>
  </main>
</template>
