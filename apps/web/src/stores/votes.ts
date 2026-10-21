import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { Swipe } from '@at/shared'
import { supabase } from '@/lib/supabase'
import type { DeckEntry, ListingSummary } from '@/lib/votes'
import { useAuthStore } from './auth'

interface VoteValue {
  swipe: Swipe
}

interface UndoEntry {
  entry: DeckEntry
  previous: VoteValue | null
}

export interface MatchToast {
  id: string
  listingId: string
}

/**
 * Votes, the swipe deck and listing summaries for the open hunt. Other members'
 * votes are only readable through the summary/deck RPCs, so every change
 * (ours or a partner's) shows up as a listing_events row and triggers a refetch.
 */
export const useVotesStore = defineStore('votes', () => {
  const auth = useAuthStore()
  const huntId = ref<string | null>(null)
  const summaries = ref<Record<string, ListingSummary>>({})
  const deck = ref<DeckEntry[]>([])
  const deckLoaded = ref(false)
  const undoStack = ref<UndoEntry[]>([])
  const toasts = ref<MatchToast[]>([])
  /** Swiped cards whose write hasn't landed yet; kept out of refetched decks. */
  const inFlight = new Set<string>()
  /** The card brought back by undo stays on top until the next swipe. */
  let pinnedId: string | null = null
  let channel: RealtimeChannel | null = null
  let refreshTimer: ReturnType<typeof setTimeout> | undefined

  async function fetchSummaries() {
    const id = huntId.value
    if (!id) return
    const { data, error } = await supabase.rpc('hunt_listing_summaries', { p_hunt_id: id })
    if (error) throw error
    if (id !== huntId.value) return
    const rows = data as unknown as ListingSummary[]
    summaries.value = Object.fromEntries(rows.map((s) => [s.listing_id, s]))
  }

  async function fetchDeck() {
    const id = huntId.value
    if (!id) return
    const { data, error } = await supabase.rpc('next_deck_cards', { p_hunt_id: id, p_limit: 50 })
    if (error) throw error
    if (id !== huntId.value) return
    const rows = (data as unknown as DeckEntry[]).filter((e) => !inFlight.has(e.listing_id))
    const pinned = rows.findIndex((e) => e.listing_id === pinnedId)
    if (pinned > 0) rows.unshift(...rows.splice(pinned, 1))
    deck.value = rows
    deckLoaded.value = true
  }

  async function refresh() {
    await Promise.all([fetchSummaries(), fetchDeck()])
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => void refresh().catch(() => {}), 250)
  }

  async function open(id: string) {
    if (huntId.value === id) return
    close()
    huntId.value = id
    await refresh()
    channel = supabase
      .channel(`votes:${id}`)
      // listing_events has no hunt_id column; the deciding events carry it in the payload.
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'listing_events' },
        ({ new: row }) => {
          const event = row as { id: string; listing_id: string; type: string; payload: unknown }
          const payload = (event.payload ?? {}) as { hunt_id?: string }
          if (payload.hunt_id !== id) return
          // Alone in a hunt, every listing you add is a "match": no toast for that.
          const solo = Object.values(summaries.value).every((s) => s.member_count <= 1)
          if (event.type === 'matched' && !solo) {
            toasts.value.push({ id: event.id, listingId: event.listing_id })
          }
          scheduleRefresh()
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'listings', filter: `hunt_id=eq.${id}` },
        scheduleRefresh,
      )
      .subscribe()
  }

  function close() {
    if (channel) void supabase.removeChannel(channel)
    channel = null
    clearTimeout(refreshTimer)
    huntId.value = null
    summaries.value = {}
    deck.value = []
    deckLoaded.value = false
    undoStack.value = []
    toasts.value = []
    pinnedId = null
  }

  async function writeVote(listingId: string, value: VoteValue | null) {
    const { error } = value
      ? await supabase
          .from('votes')
          // Stars are no longer used; a vote clears any left from before.
          .upsert({ listing_id: listingId, swipe: value.swipe, stars: null })
      : await supabase
          .from('votes')
          .delete()
          .eq('listing_id', listingId)
          .eq('user_id', auth.userId!)
    if (error) throw error
  }

  function myVote(listingId: string): VoteValue | null {
    const s = summaries.value[listingId]
    return s?.my_swipe ? { swipe: s.my_swipe } : null
  }

  /** Swipes the top card away right away and records the vote. */
  async function swipeCard(entry: DeckEntry, swipe: Swipe) {
    const id = entry.listing_id
    undoStack.value.push({ entry, previous: myVote(id) })
    pinnedId = null
    deck.value = deck.value.filter((e) => e.listing_id !== id)
    inFlight.add(id)
    try {
      await writeVote(id, { swipe })
    } catch (e) {
      undoStack.value.pop()
      deck.value.unshift(entry)
      throw e
    } finally {
      inFlight.delete(id)
      scheduleRefresh()
    }
  }

  /** Restores the vote from before the last swipe and puts the card back on top. */
  async function undo() {
    const last = undoStack.value.pop()
    if (!last) return
    const id = last.entry.listing_id
    await writeVote(id, last.previous)
    pinnedId = id
    if (!deck.value.some((e) => e.listing_id === id)) deck.value.unshift(last.entry)
    scheduleRefresh()
  }

  /** Votes from outside the deck (listing detail). */
  async function setVote(listingId: string, swipe: Swipe) {
    await writeVote(listingId, { swipe })
    await refresh()
  }

  async function requestReconsider(listingId: string, note: string) {
    const { data, error } = await supabase.rpc('request_reconsider', {
      p_listing_id: listingId,
      p_note: note,
    })
    if (error) throw error
    await refresh()
    return data as { cleared_own: boolean; requested: string[]; already_open: string[] }
  }

  function dismissToast(id: string) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  return {
    huntId,
    summaries,
    deck,
    deckLoaded,
    undoStack,
    toasts,
    open,
    close,
    refresh,
    swipeCard,
    undo,
    setVote,
    requestReconsider,
    dismissToast,
  }
})
