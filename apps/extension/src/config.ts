import { CONFIG_KEY, readValue, writeValue, type KeyValueArea } from './storage.ts'

/** Where the extension talks to. Defaults come from the build; the options page overrides them. */
export interface ExtensionConfig {
  supabaseUrl: string
  /** The public anon key. Never the service-role key. */
  anonKey: string
  /** The web app root, e.g. https://me.github.io/repo/ (listing links are <webAppUrl>#/h/…). */
  webAppUrl: string
}

export function defaultConfig(): ExtensionConfig {
  return {
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
    webAppUrl: import.meta.env.VITE_WEB_APP_URL ?? '',
  }
}

/** Saved overrides on top of the build defaults; blank saved fields fall back to the defaults. */
export async function loadConfig(area: KeyValueArea): Promise<ExtensionConfig> {
  const saved = (await readValue<Partial<ExtensionConfig>>(area, CONFIG_KEY)) ?? {}
  const defaults = defaultConfig()
  return {
    supabaseUrl: saved.supabaseUrl?.trim() || defaults.supabaseUrl,
    anonKey: saved.anonKey?.trim() || defaults.anonKey,
    webAppUrl: saved.webAppUrl?.trim() || defaults.webAppUrl,
  }
}

export async function saveConfig(area: KeyValueArea, config: ExtensionConfig): Promise<void> {
  await writeValue(area, CONFIG_KEY, {
    supabaseUrl: config.supabaseUrl.trim().replace(/\/+$/, ''),
    anonKey: config.anonKey.trim(),
    webAppUrl: config.webAppUrl.trim(),
  })
}

export function isConfigured(c: ExtensionConfig): boolean {
  return /^https?:\/\/.+/.test(c.supabaseUrl) && c.anonKey.length > 0
}

/** A JWT whose payload says role=service_role must never be stored here. */
export function isServiceRoleKey(key: string): boolean {
  if (/^sb_secret_/.test(key.trim())) return true
  const payload = key.split('.')[1]
  if (!payload) return false
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    return json?.role === 'service_role'
  } catch {
    return false
  }
}
