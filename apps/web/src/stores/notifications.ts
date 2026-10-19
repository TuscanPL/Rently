import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { NotificationKind } from '@at/shared'
import { supabase, type Tables } from '@/lib/supabase'

export type AppNotification = Tables<'notifications'> & { hunts: { name: string } | null }
export type NotificationPrefs = Pick<Tables<'notification_prefs'>, NotificationKind>

const FEED_SIZE = 50

/**
 * The signed-in user's notification feed (rows written by the database for
 * listing events, see 20261024000000_notifications.sql) and their per-kind
 * switches. App.vue starts it on sign-in; new rows arrive over Realtime.
 */
export const useNotificationsStore = defineStore('notifications', () => {
  // Shallow: rows are replaced, never mutated (and the Json payload type is too
  // deep for ref()'s unwrapping).
  const items = shallowRef<AppNotification[]>([])
  const loaded = ref(false)
  const prefs = ref<NotificationPrefs | null>(null)
  let userId: string | null = null
  let channel: RealtimeChannel | null = null
  let refetchTimer: ReturnType<typeof setTimeout> | undefined

  const unreadCount = computed(() => items.value.filter((n) => !n.read_at).length)

  async function fetchFeed() {
    const id = userId
    if (!id) return
    const { data, error } = await supabase
      .from('notifications')
      .select('*, hunts(name)')
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .limit(FEED_SIZE)
    if (error) throw error
    if (id !== userId) return
    items.value = data
    loaded.value = true
  }

  function scheduleFetch() {
    clearTimeout(refetchTimer)
    refetchTimer = setTimeout(() => void fetchFeed().catch(() => {}), 200)
  }

  async function start(id: string) {
    if (userId === id) return
    stop()
    userId = id
    channel = supabase
      .channel(`notifications:${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${id}` },
        // Refetch rather than splice the row in: the feed shows the hunt name too.
        scheduleFetch,
      )
      .subscribe()
    await fetchFeed()
  }

  function stop() {
    if (channel) void supabase.removeChannel(channel)
    channel = null
    clearTimeout(refetchTimer)
    userId = null
    items.value = []
    loaded.value = false
    prefs.value = null
  }

  async function markRead(ids: string[]) {
    const unread = ids.filter((id) => items.value.find((n) => n.id === id && !n.read_at))
    if (unread.length === 0) return
    const now = new Date().toISOString()
    items.value = items.value.map((n) => (unread.includes(n.id) ? { ...n, read_at: now } : n))
    const { error } = await supabase.from('notifications').update({ read_at: now }).in('id', unread)
    if (error) throw error
  }

  const markAllRead = () => markRead(items.value.map((n) => n.id))

  async function loadPrefs() {
    if (!userId) return
    const { data, error } = await supabase
      .from('notification_prefs')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw error
    // No row yet: everything is on.
    prefs.value = data ?? {
      match: true,
      listing_added: true,
      reconsider_request: true,
      status_changed: true,
      ad_removed: true,
      price_dropped: true,
    }
  }

  async function setPref(kind: NotificationKind, value: boolean) {
    if (!userId || !prefs.value) return
    const previous = prefs.value[kind]
    prefs.value[kind] = value
    const { error } = await supabase
      .from('notification_prefs')
      .upsert({ user_id: userId, ...prefs.value })
    if (error) {
      prefs.value[kind] = previous
      throw error
    }
  }

  return {
    items,
    loaded,
    prefs,
    unreadCount,
    start,
    stop,
    fetchFeed,
    markRead,
    markAllRead,
    loadPrefs,
    setPref,
  }
})
