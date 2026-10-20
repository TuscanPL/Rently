import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { PinKind } from '@at/shared'
import { supabase } from '@/lib/supabase'
import type { Pin } from '@/lib/geo'

export interface PinInput {
  label: string
  kind: PinKind
  lat: number
  lng: number
}

/** The open hunt's pins. Any member may manage them. */
export const usePinsStore = defineStore('pins', () => {
  const huntId = ref<string | null>(null)
  const pins = ref<Pin[]>([])

  async function fetchAll() {
    if (!huntId.value) return
    const { data, error } = await supabase
      .from('pins')
      .select('*')
      .eq('hunt_id', huntId.value)
      .order('label')
    if (error) throw error
    pins.value = data
  }

  async function open(id: string) {
    if (huntId.value === id) return
    huntId.value = id
    pins.value = []
    await fetchAll()
  }

  function close() {
    huntId.value = null
  }

  async function add(input: PinInput) {
    const { data, error } = await supabase
      .from('pins')
      .insert({ ...input, hunt_id: huntId.value! })
      .select()
      .single()
    if (error) throw error
    pins.value = [...pins.value, data].sort((a, b) => a.label.localeCompare(b.label))
    return data
  }

  async function update(id: string, input: PinInput) {
    const { data, error } = await supabase.from('pins').update(input).eq('id', id).select().single()
    if (error) throw error
    pins.value = pins.value
      .map((p) => (p.id === id ? data : p))
      .sort((a, b) => a.label.localeCompare(b.label))
  }

  async function remove(id: string) {
    const { error } = await supabase.from('pins').delete().eq('id', id)
    if (error) throw error
    pins.value = pins.value.filter((p) => p.id !== id)
  }

  return { huntId, pins, open, close, fetchAll, add, update, remove }
})
