import { ext } from './ext.ts'

// chrome.storage.local wrappers. Popup and options pages share it, and it
// outlives the popup, which closes as soon as the user clicks elsewhere.

/** The part of chrome.storage.StorageArea we use; tests pass an in-memory fake. */
export interface KeyValueArea {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
  remove(key: string): Promise<void>
}

export function localArea(): KeyValueArea {
  return ext.storage.local as unknown as KeyValueArea
}

/** supabase-js `auth.storage` backed by an extension storage area. */
export function supabaseStorage(area: KeyValueArea) {
  return {
    async getItem(key: string): Promise<string | null> {
      const items = await area.get(key)
      const value = items[key]
      return typeof value === 'string' ? value : null
    },
    async setItem(key: string, value: string): Promise<void> {
      await area.set({ [key]: value })
    },
    async removeItem(key: string): Promise<void> {
      await area.remove(key)
    },
  }
}

export async function readValue<T>(area: KeyValueArea, key: string): Promise<T | undefined> {
  return (await area.get(key))[key] as T | undefined
}

export async function writeValue(area: KeyValueArea, key: string, value: unknown): Promise<void> {
  if (value === undefined || value === null) await area.remove(key)
  else await area.set({ [key]: value })
}

/** Keys of our own settings and UI state (supabase-js keeps its session under "sb-…"). */
export const CONFIG_KEY = 'at:config'
export const LAST_HUNT_KEY = 'at:lastHuntId'
/** Email a sign-in code was sent to, so reopening the popup goes straight to the code field. */
export const PENDING_EMAIL_KEY = 'at:pendingEmail'
