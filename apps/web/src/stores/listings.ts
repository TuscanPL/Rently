import { defineStore } from 'pinia'
import { ref, type Ref } from 'vue'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { ListingStatus } from '@at/shared'
import type { IngestResponse, ListingWithPhotos } from '@/lib/listings'

export const useListingsStore = defineStore('listings', () => {
  const huntId = ref<string | null>(null)
  // Typed as Ref<T> rather than ref<T>() so Vue doesn't unwrap the recursive Json columns (TS2589).
  const listings = ref([]) as Ref<ListingWithPhotos[]>
  const loading = ref(false)
  /** Result of the latest add, so the detail page can offer the duplicate prompt. */
  const lastIngest = ref<IngestResponse | null>(null)
  let channel: RealtimeChannel | null = null
  let refreshTimer: ReturnType<typeof setTimeout> | undefined

  async function fetchAll() {
    if (!huntId.value) return
    const { data, error } = await supabase
      .from('listings')
      .select('*, listing_photos(*)')
      .eq('hunt_id', huntId.value)
      .order('created_at', { ascending: false })
    if (error) throw error
    listings.value = data
  }

  /** Loads a hunt's listings and keeps them fresh while partners add or edit. */
  async function open(id: string) {
    if (huntId.value === id) return
    close()
    huntId.value = id
    listings.value = []
    loading.value = true
    try {
      await fetchAll()
    } finally {
      loading.value = false
    }
    channel = supabase
      .channel(`listings:${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'listings', filter: `hunt_id=eq.${id}` },
        () => {
          clearTimeout(refreshTimer)
          refreshTimer = setTimeout(() => void fetchAll(), 300)
        },
      )
      .subscribe()
  }

  function close() {
    if (channel) void supabase.removeChannel(channel)
    channel = null
    huntId.value = null
  }

  function byId(id: string): ListingWithPhotos | null {
    return listings.value.find((l) => l.id === id) ?? null
  }

  /**
   * Moves a listing along the pipeline. A trigger logs the status_changed event.
   * `viewingAt` (ISO) is only written when given; the old time stays otherwise.
   */
  async function setStatus(id: string, status: ListingStatus, viewingAt?: string | null) {
    const patch = viewingAt === undefined ? { status } : { status, viewing_at: viewingAt }
    const { data, error } = await supabase
      .from('listings')
      .update(patch)
      .eq('id', id)
      .select('*, listing_photos(*)')
      .single()
    if (error) throw error
    listings.value = listings.value.map((l) => (l.id === id ? data : l))
    return data
  }

  return { huntId, listings, loading, lastIngest, open, close, fetchAll, byId, setStatus }
})
