import { describe, expect, it } from 'vitest'
import { resultFromUrlOnly } from '@at/parsers'
import { buildManifest } from './manifest.ts'
import { isConfigured, isServiceRoleKey, loadConfig, saveConfig } from './config.ts'
import { ingestBody, isReadableUrl, listingLink, preview } from './ingest.ts'
import { CONFIG_KEY, supabaseStorage, type KeyValueArea } from './storage.ts'

/** chrome.storage.local stand-in. */
function memoryArea(): KeyValueArea & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {}
  return {
    data,
    get: async (key) => (key in data ? { [key]: data[key] } : {}),
    set: async (items) => void Object.assign(data, items),
    remove: async (key) => void delete data[key],
  }
}

describe('manifest', () => {
  it('chrome: MV3 popup, no background, minimal permissions', () => {
    const m = buildManifest({
      target: 'chrome',
      version: '1.2.3',
      supabaseUrl: 'https://abc.supabase.co/',
    })
    expect(m).toMatchObject({
      manifest_version: 3,
      version: '1.2.3',
      action: { default_popup: 'popup.html' },
      options_ui: { page: 'options.html' },
      permissions: ['activeTab', 'scripting', 'storage'],
      host_permissions: ['https://abc.supabase.co/*'],
    })
    expect(m).not.toHaveProperty('background')
    expect(m).not.toHaveProperty('browser_specific_settings')
  })

  it('firefox: gecko id and data collection declaration', () => {
    const m = buildManifest({ target: 'firefox', version: '1.0.0', geckoId: 'at@me.dev' })
    expect(m).toMatchObject({
      browser_specific_settings: {
        gecko: { id: 'at@me.dev', data_collection_permissions: { required: expect.any(Array) } },
      },
    })
    expect(m).not.toHaveProperty('host_permissions')
  })
})

describe('supabase storage adapter', () => {
  it('stores session strings in the storage area', async () => {
    const area = memoryArea()
    const storage = supabaseStorage(area)
    expect(await storage.getItem('sb-x-auth-token')).toBeNull()
    await storage.setItem('sb-x-auth-token', '{"access_token":"t"}')
    expect(area.data['sb-x-auth-token']).toBe('{"access_token":"t"}')
    expect(await storage.getItem('sb-x-auth-token')).toBe('{"access_token":"t"}')
    await storage.removeItem('sb-x-auth-token')
    expect(await storage.getItem('sb-x-auth-token')).toBeNull()
  })
})

describe('config', () => {
  it('saved values override build defaults; blanks fall back', async () => {
    const area = memoryArea()
    await saveConfig(area, {
      supabaseUrl: ' https://fork.supabase.co/ ',
      anonKey: 'anon',
      webAppUrl: '',
    })
    expect(area.data[CONFIG_KEY]).toMatchObject({ supabaseUrl: 'https://fork.supabase.co' })
    const c = await loadConfig(area)
    expect(c.supabaseUrl).toBe('https://fork.supabase.co')
    expect(c.anonKey).toBe('anon')
    expect(c.webAppUrl).toBe(import.meta.env.VITE_WEB_APP_URL ?? '')
    expect(isConfigured(c)).toBe(true)
    expect(isConfigured({ ...c, anonKey: '' })).toBe(false)
  })

  it('recognises service-role keys', () => {
    const jwt = (payload: object) =>
      `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.sig`
    expect(isServiceRoleKey(jwt({ role: 'service_role' }))).toBe(true)
    expect(isServiceRoleKey(jwt({ role: 'anon' }))).toBe(false)
    expect(isServiceRoleKey('sb_secret_abc')).toBe(true)
    expect(isServiceRoleKey('sb_publishable_abc')).toBe(false)
    expect(isServiceRoleKey('garbage')).toBe(false)
  })
})

describe('ingest helpers', () => {
  const result = {
    ...resultFromUrlOnly('https://www.otodom.pl/pl/oferta/mieszkanie-mokotow-ID1'),
  }
  result.listing = { ...result.listing, rent: 4000, adminFee: 600, areaM2: 52.5, rooms: 2 }

  it('sends the parsed listing for the chosen hunt', () => {
    expect(ingestBody('h1', result)).toEqual({ huntId: 'h1', parsed: result.listing })
  })

  it('links to the listing in the web app', () => {
    expect(listingLink('https://me.github.io/repo/', 'h1', 'l1')).toBe(
      'https://me.github.io/repo/#/h/h1/l/l1',
    )
    expect(listingLink('https://me.github.io/repo#/hunts', 'h1', 'l1')).toBe(
      'https://me.github.io/repo/#/h/h1/l/l1',
    )
  })

  it('previews total cost, area, rooms and confidence', () => {
    const p = preview(result)
    expect(p.title).toBe('Mieszkanie mokotow')
    expect(p.total.replace(/\s/g, ' ')).toBe('4 600 zł')
    expect(p.area).toBe('52,5 m²')
    expect(p.rooms).toBe('2')
    expect(p.confidence).toBe(Math.round(result.confidence * 100))
    expect(p.missing).toContain('photos')
  })

  it('only reads http(s) pages', () => {
    expect(isReadableUrl('https://www.otodom.pl/x')).toBe(true)
    expect(isReadableUrl('chrome://extensions')).toBe(false)
    expect(isReadableUrl('https://chromewebstore.google.com/detail/x')).toBe(false)
    expect(isReadableUrl(undefined)).toBe(false)
  })
})
