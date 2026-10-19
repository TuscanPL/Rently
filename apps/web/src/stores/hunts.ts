import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { supabase, type Tables } from '@/lib/supabase'
import { useAuthStore } from './auth'
import { LAST_HUNT_KEY, writeLocal } from '@/lib/storage'

export type Hunt = Tables<'hunts'>
export type HuntMember = Tables<'hunt_members'> & {
  profiles: Pick<Tables<'profiles'>, 'display_name' | 'avatar_url'> | null
}

export const useHuntsStore = defineStore('hunts', () => {
  const hunts = ref<(Hunt & { hunt_members: { count: number }[] })[]>([])
  const current = ref<Hunt | null>(null)
  const members = ref<HuntMember[]>([])

  const auth = useAuthStore()
  const myRole = computed(() => members.value.find((m) => m.user_id === auth.userId)?.role ?? null)
  const isOwner = computed(() => myRole.value === 'owner')

  async function fetchHunts() {
    const { data, error } = await supabase
      .from('hunts')
      .select('*, hunt_members(count)')
      .order('created_at', { ascending: false })
    if (error) throw error
    hunts.value = data
  }

  async function createHunt(name: string, city: string) {
    const { data, error } = await supabase.rpc('create_hunt', { p_name: name, p_city: city })
    if (error) throw error
    return data
  }

  async function openHunt(id: string) {
    if (current.value?.id !== id) {
      current.value = null
      members.value = []
    }
    const [hunt, mems] = await Promise.all([
      supabase.from('hunts').select('*').eq('id', id).maybeSingle(),
      supabase
        .from('hunt_members')
        .select('*, profiles(display_name, avatar_url)')
        .eq('hunt_id', id)
        .order('joined_at'),
    ])
    if (hunt.error) throw hunt.error
    if (mems.error) throw mems.error
    current.value = hunt.data
    members.value = mems.data
    writeLocal(LAST_HUNT_KEY, hunt.data ? id : null)
    return hunt.data
  }

  async function updateHunt(
    patch: Partial<Pick<Hunt, 'name' | 'city' | 'reveal_votes_after_both'>>,
  ) {
    if (!current.value) return
    const { data, error } = await supabase
      .from('hunts')
      .update(patch)
      .eq('id', current.value.id)
      .select()
      .single()
    if (error) throw error
    current.value = data
  }

  async function removeMember(userId: string) {
    if (!current.value) return
    const { error } = await supabase
      .from('hunt_members')
      .delete()
      .eq('hunt_id', current.value.id)
      .eq('user_id', userId)
    if (error) throw error
    members.value = members.value.filter((m) => m.user_id !== userId)
  }

  async function deleteHunt() {
    if (!current.value) return
    const { error } = await supabase.from('hunts').delete().eq('id', current.value.id)
    if (error) throw error
    writeLocal(LAST_HUNT_KEY, null)
    current.value = null
  }

  return {
    hunts,
    current,
    members,
    myRole,
    isOwner,
    fetchHunts,
    createHunt,
    openHunt,
    updateHunt,
    removeMember,
    deleteHunt,
  }
})
