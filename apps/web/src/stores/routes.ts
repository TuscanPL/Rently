import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { routeKey, type ListingRoute } from '@/lib/transit'

interface TransitResponse {
  computed: number
  remaining: number
}

/**
 * Public transport trips from the open hunt's listings to its pins. Trips are
 * looked up once by the transit-routes edge function and stored; this store
 * reads them and asks the function to fill in any that are missing.
 */
export const useRoutesStore = defineStore('routes', () => {
  const huntId = ref<string | null>(null)
  const routes = ref<Record<string, ListingRoute>>({})
  /** A lookup is running, so missing trips show as "looking up" rather than absent. */
  const fetching = ref(false)
  let channel: RealtimeChannel | null = null

  async function fetchAll() {
    if (!huntId.value) return
    const { data, error } = await supabase
      .from('listing_routes')
      .select('*, listings!inner(hunt_id)')
      .eq('listings.hunt_id', huntId.value)
    if (error) throw error
    routes.value = Object.fromEntries(
      data.map(({ listings: _, ...r }) => [routeKey(r.listing_id, r.pin_id), r]),
    )
  }

  function get(listingId: string, pinId: string): ListingRoute | undefined {
    return routes.value[routeKey(listingId, pinId)]
  }

  /**
   * Has the function look up trips not stored yet. It works in small batches,
   * so keep asking while it makes progress; stop when it can't (busy, offline).
   */
  async function fillMissing() {
    const id = huntId.value
    if (!id || fetching.value) return
    fetching.value = true
    try {
      for (let round = 0; round < 10 && huntId.value === id; round++) {
        const { data, error } = await supabase.functions.invoke<TransitResponse>('transit-routes', {
          body: { huntId: id },
        })
        if (error || !data) break
        if (data.remaining === 0 || data.computed === 0) break
      }
    } finally {
      fetching.value = false
    }
  }

  async function open(id: string) {
    if (huntId.value === id) return
    close()
    huntId.value = id
    routes.value = {}
    await fetchAll()
    // Realtime respects RLS, so only this user's hunts' trips arrive here.
    channel = supabase
      .channel(`routes:${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'listing_routes' }, (p) => {
        const row = (p.eventType === 'DELETE' ? p.old : p.new) as ListingRoute
        const key = routeKey(row.listing_id, row.pin_id)
        if (p.eventType === 'DELETE') {
          const { [key]: _, ...rest } = routes.value
          routes.value = rest
        } else {
          routes.value = { ...routes.value, [key]: row }
        }
      })
      .subscribe()
  }

  function close() {
    if (channel) void supabase.removeChannel(channel)
    channel = null
    huntId.value = null
  }

  return { huntId, routes, fetching, get, fetchAll, fillMissing, open, close }
})
