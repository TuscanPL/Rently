import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { supabase, type Tables } from '@/lib/supabase'
import { latestPriceChange } from '@/lib/priceChange'
import { useListingsStore } from './listings'

type PricePoint = Pick<
  Tables<'listing_price_history'>,
  'listing_id' | 'rent' | 'admin_fee' | 'observed_at'
>

/**
 * Recent price changes of every listing in a hunt, for the badges on cards.
 * One query per hunt, repeated whenever the listings store refreshes: the daily
 * re-check updates the listing's price, which arrives over Realtime.
 */
export const usePriceChangesStore = defineStore('priceChanges', () => {
  const huntId = ref<string | null>(null)
  const history = ref<PricePoint[]>([])
  const listingsStore = useListingsStore()
  let timer: ReturnType<typeof setTimeout> | undefined

  async function fetchAll() {
    if (!huntId.value) return
    const { data } = await supabase
      .from('listing_price_history')
      .select('listing_id, rent, admin_fee, observed_at, listings!inner(hunt_id)')
      .eq('listings.hunt_id', huntId.value)
      .order('observed_at')
    history.value = (data ?? []).map(({ listing_id, rent, admin_fee, observed_at }) => ({
      listing_id,
      rent,
      admin_fee,
      observed_at,
    }))
  }

  function open(id: string) {
    if (huntId.value === id) return
    huntId.value = id
    history.value = []
    void fetchAll()
  }

  watch(
    () => listingsStore.listings,
    () => {
      clearTimeout(timer)
      timer = setTimeout(() => void fetchAll(), 300)
    },
  )

  const byListing = computed(() => {
    const groups = new Map<string, PricePoint[]>()
    for (const p of history.value) {
      groups.set(p.listing_id, [...(groups.get(p.listing_id) ?? []), p])
    }
    const out: Record<string, { delta: number; at: string }> = {}
    for (const [id, points] of groups) {
      const change = latestPriceChange(points)
      if (change) out[id] = change
    }
    return out
  })

  return { huntId, open, fetchAll, byListing }
})
