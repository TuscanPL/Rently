import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { IngestResponse, ListingWithPhotos } from '@/lib/listings'

export const useListingsStore = defineStore('listings', () => {
  const huntId = ref<string | null>(null)
  const listings = ref<ListingWithPhotos[]>([])
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

  return { huntId, listings, loading, lastIngest, open, close, fetchAll }
})
