import { beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@at/shared/database'
import {
  buildMessage,
  createSendPushHandler,
  planDeliveries,
  type SendPushResponse,
} from './index.ts'
import { generateVapidKeys } from './webpush.ts'

type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const stackUp = await fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: ANON_KEY } })
  .then((r) => r.ok)
  .catch(() => false)

// A real browser key pair (RFC 8291's), so the payload can actually be encrypted.
const P256DH =
  'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'
const AUTH = 'BTBZMqHH6r4Tts7J_aSIgg'

const HUNT = '11111111-0000-4000-b000-000000000001'
const LISTING = '11111111-0000-4000-c000-000000000001'

function notification(
  kind: Row<'notifications'>['kind'],
  payload: Record<string, unknown>,
  extra: Partial<Row<'notifications'>> = {},
): Row<'notifications'> {
  return {
    id: crypto.randomUUID(),
    user_id: 'u1',
    hunt_id: HUNT,
    listing_id: LISTING,
    event_id: null,
    kind,
    payload: payload as Row<'notifications'>['payload'],
    read_at: null,
    pushed_at: null,
    created_at: new Date().toISOString(),
    ...extra,
  }
}

describe('buildMessage', () => {
  const listingUrl = `#/h/${HUNT}/l/${LISTING}`

  it('writes a short title and body per kind, linking to the listing', () => {
    const cases = [
      [
        notification('match', { listing_title: 'Sunny flat' }),
        "It's a match 🏠",
        'Everyone said yes to Sunny flat',
      ],
      [
        notification('listing_added', { listing_title: 'Sunny flat', actor_name: 'Ala' }),
        'Ala added a listing',
        'Sunny flat',
      ],
      [
        notification('status_changed', {
          listing_title: 'Sunny flat',
          actor_name: 'Ala',
          from: 'new',
          to: 'viewing_booked',
        }),
        'Sunny flat',
        'Ala moved it to Viewing booked',
      ],
      [
        notification('ad_removed', { listing_title: 'Sunny flat' }),
        'Ad taken down',
        'Sunny flat is no longer online',
      ],
      [
        notification('price_dropped', {
          listing_title: 'Sunny flat',
          total_before: 4950,
          total_after: 4700,
        }),
        'Price dropped',
        'Sunny flat: 4 950 zł → 4 700 zł',
      ],
    ] as const
    for (const [n, title, body] of cases) {
      const message = buildMessage(n)
      expect(message.title).toBe(title)
      expect(message.body.replace(/\s/g, ' ')).toBe(body)
      expect(message.url).toBe(listingUrl)
      expect(message.tag).toBe(`${n.kind}:${LISTING}`)
      expect(message.notificationId).toBe(n.id)
    }
  })

  it('sends reconsider requests to the deck, with the note', () => {
    const message = buildMessage(
      notification('reconsider_request', {
        listing_title: 'Sunny flat',
        actor_name: 'Bartek',
        note: 'The balcony!',
      }),
    )
    expect(message).toMatchObject({
      title: 'Bartek asks you to reconsider',
      body: 'Sunny flat: “The balcony!”',
      url: `#/h/${HUNT}/deck`,
    })
  })

  it('falls back when the snapshot is missing', () => {
    const message = buildMessage(notification('listing_added', {}))
    expect(message.title).toBe('Someone added a listing')
    expect(message.body).toBe('Untitled listing')
  })
})

describe('planDeliveries', () => {
  const sub = (id: string, user_id: string): Row<'push_subscriptions'> => ({
    id,
    user_id,
    endpoint: `https://push.example.net/${id}`,
    p256dh: P256DH,
    auth: AUTH,
    user_agent: null,
    created_at: '',
  })
  const prefs = (user_id: string, patch: Partial<Row<'notification_prefs'>>) => ({
    user_id,
    match: true,
    listing_added: true,
    reconsider_request: true,
    status_changed: true,
    ad_removed: true,
    price_dropped: true,
    updated_at: '',
    ...patch,
  })

  it("sends to every device of the recipient, honouring the recipient's switches", () => {
    const added1 = notification('listing_added', {}, { user_id: 'u1' })
    const added2 = notification('listing_added', {}, { user_id: 'u2' })
    const match2 = notification('match', {}, { user_id: 'u2' })
    const plan = planDeliveries(
      [added1, added2, match2],
      // u1 has no prefs row (everything on); u2 switched "listing added" off.
      [prefs('u2', { listing_added: false })],
      [sub('a', 'u1'), sub('b', 'u1'), sub('c', 'u2'), sub('d', 'u3')],
    )
    expect(plan.map((d) => [d.notification.id, d.subscription.id])).toEqual([
      [added1.id, 'a'],
      [added1.id, 'b'],
      [match2.id, 'c'],
    ])
  })
})

describe.skipIf(!stackUp)('send-push handler', () => {
  const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  })
  const pushed: { url: string; body: Uint8Array }[] = []
  const fakePush = (async (url: string, init: RequestInit) => {
    pushed.push({ url, body: init.body as Uint8Array })
    return new Response(null, { status: url.includes('/expired/') ? 410 : 201 })
  }) as unknown as typeof fetch
  let vapid: Awaited<ReturnType<typeof generateVapidKeys>>
  let handler: ReturnType<typeof createSendPushHandler>
  const users: string[] = []
  let huntId = ''
  const run = Date.now().toString(36)

  const call = async (body: unknown, secret = 'test-secret') => {
    const res = await handler(
      new Request('http://localhost/send-push', {
        method: 'POST',
        headers: { 'x-push-secret': secret, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )
    return { status: res.status, body: (await res.json()) as SendPushResponse }
  }

  async function notify(userId: string, kind: Row<'notifications'>['kind']) {
    const { data, error } = await admin
      .from('notifications')
      .insert({ user_id: userId, hunt_id: huntId, kind, payload: { listing_title: 'Push flat' } })
      .select('id')
      .single()
    if (error) throw error
    return data.id
  }

  beforeAll(async () => {
    vapid = await generateVapidKeys('mailto:test@example.com')
    handler = createSendPushHandler({
      supabaseUrl: SUPABASE_URL,
      serviceRoleKey: SERVICE_KEY,
      webhookSecret: 'test-secret',
      vapid,
      fetchPush: fakePush,
    })
    for (const name of ['ala', 'bartek']) {
      const { data, error } = await admin.auth.admin.createUser({
        email: `push-${name}-${run}@test.local`,
        email_confirm: true,
      })
      if (error) throw error
      users.push(data.user.id)
    }
    const { data: hunt, error } = await admin
      .from('hunts')
      .insert({ name: 'Push hunt', created_by: users[0]! })
      .select('id')
      .single()
    if (error) throw error
    huntId = hunt.id
    await admin.from('push_subscriptions').insert([
      {
        user_id: users[0]!,
        endpoint: `https://push.example.net/ok/${run}-a1`,
        p256dh: P256DH,
        auth: AUTH,
      },
      {
        user_id: users[0]!,
        endpoint: `https://push.example.net/expired/${run}-a2`,
        p256dh: P256DH,
        auth: AUTH,
      },
      {
        user_id: users[1]!,
        endpoint: `https://push.example.net/ok/${run}-b1`,
        p256dh: P256DH,
        auth: AUTH,
      },
    ])
    await admin.from('notification_prefs').insert({ user_id: users[1]!, match: false })
  })

  it('rejects calls without the shared secret', async () => {
    expect((await call({ notification_ids: [crypto.randomUUID()] }, 'wrong')).status).toBe(401)
  })

  it('pushes to each device, drops expired subscriptions, and only once', async () => {
    const forAla = await notify(users[0]!, 'listing_added')
    const forBartek = await notify(users[1]!, 'match') // Bartek switched matches off

    const { status, body } = await call({ notification_ids: [forAla, forBartek] })
    expect(status).toBe(200)
    expect(body).toEqual({ sent: 1, failed: 0, removed: 1 })
    expect(pushed.map((p) => new URL(p.url).pathname).sort()).toEqual([
      `/expired/${run}-a2`,
      `/ok/${run}-a1`,
    ])

    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('endpoint')
      .in('user_id', users)
    expect(subs!.map((s) => s.endpoint).sort()).toEqual([
      `https://push.example.net/ok/${run}-a1`,
      `https://push.example.net/ok/${run}-b1`,
    ])
    const { data: rows } = await admin
      .from('notifications')
      .select('pushed_at')
      .in('id', [forAla, forBartek])
    expect(rows!.every((r) => r.pushed_at)).toBe(true)

    // A repeated call finds nothing left to push.
    pushed.length = 0
    expect((await call({ notification_ids: [forAla] })).body).toEqual({
      sent: 0,
      failed: 0,
      removed: 0,
    })
    expect(pushed).toHaveLength(0)
  })

  it('skips delivery when VAPID keys are not configured', async () => {
    const unconfigured = createSendPushHandler({
      supabaseUrl: SUPABASE_URL,
      serviceRoleKey: SERVICE_KEY,
      webhookSecret: 'test-secret',
      vapid: { publicKey: '', privateKey: '', subject: '' },
      fetchPush: fakePush,
    })
    const res = await unconfigured(
      new Request('http://localhost/send-push', {
        method: 'POST',
        headers: { 'x-push-secret': 'test-secret' },
        body: JSON.stringify({ notification_ids: [crypto.randomUUID()] }),
      }),
    )
    expect(await res.json()).toMatchObject({ sent: 0, skipped: 'not_configured' })
  })
})
