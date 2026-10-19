import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@at/shared/database'
import { formatPLN, type NotificationKind } from '@at/shared'
import { HttpError, json, withHttp } from './http.ts'
import { sendWebPush, type PushSubscriptionKeys, type VapidKeys } from './webpush.ts'

// send-push: the database's notification trigger (20261024000000_notifications.sql)
// posts {notification_ids} here after it writes feed rows. This loads those rows,
// the recipients' push subscriptions and preferences, and sends one Web Push per
// device. Subscriptions the push service no longer knows (404/410) are deleted.

type Db = SupabaseClient<Database>
type NotificationRow = Database['public']['Tables']['notifications']['Row']
type PrefsRow = Database['public']['Tables']['notification_prefs']['Row']
type SubscriptionRow = Database['public']['Tables']['push_subscriptions']['Row']

/** What the service worker gets (apps/web/src/sw.ts shows it as a notification). */
export interface PushMessage {
  title: string
  body: string
  /** Hash route inside the app, resolved against the service worker scope. */
  url: string
  /** Same tag replaces the earlier notification for that listing and kind. */
  tag: string
  notificationId: string
}

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  viewing_booked: 'Viewing booked',
  viewed: 'Viewed',
  applied: 'Applied',
  won: 'Won',
  rejected: 'Rejected',
  gone: 'Gone',
}

const payloadSchema = z.object({
  actor_name: z.string().nullish(),
  listing_title: z.string().nullish(),
  note: z.string().nullish(),
  to: z.string().nullish(),
  total_before: z.coerce.number().nullish(),
  total_after: z.coerce.number().nullish(),
})

/** Short English text per kind. The in-app feed renders its own (translated) text. */
export function buildMessage(
  n: Pick<NotificationRow, 'id' | 'kind' | 'hunt_id' | 'listing_id' | 'payload'>,
): PushMessage {
  const p = payloadSchema.safeParse(n.payload).data ?? {}
  const listing = p.listing_title?.trim() || 'Untitled listing'
  const actor = p.actor_name?.trim() || 'Someone'
  const listingUrl = n.listing_id ? `#/h/${n.hunt_id}/l/${n.listing_id}` : `#/h/${n.hunt_id}`
  const base = {
    url: listingUrl,
    tag: `${n.kind}:${n.listing_id ?? n.hunt_id}`,
    notificationId: n.id,
  }

  const texts: Record<NotificationKind, () => Pick<PushMessage, 'title' | 'body'>> = {
    match: () => ({ title: "It's a match 🏠", body: `Everyone said yes to ${listing}` }),
    listing_added: () => ({ title: `${actor} added a listing`, body: listing }),
    reconsider_request: () => ({
      title: `${actor} asks you to reconsider`,
      body: p.note?.trim() ? `${listing}: “${p.note.trim()}”` : listing,
    }),
    status_changed: () => ({
      title: `${listing}`,
      body: `${actor} moved it to ${STATUS_LABELS[p.to ?? ''] ?? p.to ?? 'a new status'}`,
    }),
    ad_removed: () => ({ title: 'Ad taken down', body: `${listing} is no longer online` }),
    price_dropped: () => ({
      title: 'Price dropped',
      body: `${listing}: ${formatPLN(p.total_before)} → ${formatPLN(p.total_after)}`,
    }),
  }
  const message = { ...base, ...texts[n.kind]() }
  // Reconsider requests are answered in the deck, where the listing is pinned on top.
  if (n.kind === 'reconsider_request') message.url = `#/h/${n.hunt_id}/deck`
  return message
}

export interface Delivery {
  notification: NotificationRow
  subscription: PushSubscriptionKeys & { id: string }
}

/**
 * Pairs each notification with its recipient's devices, skipping kinds the
 * recipient switched off since the row was written (no prefs row = all on).
 */
export function planDeliveries(
  notifications: NotificationRow[],
  prefs: PrefsRow[],
  subscriptions: SubscriptionRow[],
): Delivery[] {
  const prefsByUser = new Map(prefs.map((p) => [p.user_id, p]))
  return notifications.flatMap((notification) => {
    if (prefsByUser.get(notification.user_id)?.[notification.kind] === false) return []
    return subscriptions
      .filter((s) => s.user_id === notification.user_id)
      .map((s) => ({
        notification,
        subscription: { id: s.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
      }))
  })
}

export interface SendPushEnv {
  supabaseUrl: string
  serviceRoleKey: string
  /** Must match the `x-push-secret` header (Vault secret `push_webhook_secret`). */
  webhookSecret?: string
  vapid: VapidKeys
  /** Injectable for tests: push services aren't reachable from CI. */
  fetchPush?: typeof fetch
}

export interface SendPushResponse {
  sent: number
  failed: number
  removed: number
  skipped?: 'not_configured'
}

const bodySchema = z.object({ notification_ids: z.array(z.uuid()).min(1).max(100) })

export function createSendPushHandler(env: SendPushEnv) {
  return withHttp(async (req) => {
    if (!env.webhookSecret || req.headers.get('x-push-secret') !== env.webhookSecret) {
      throw new HttpError(401, 'Unauthorized')
    }
    const body = bodySchema.safeParse(await req.json().catch(() => null))
    if (!body.success) throw new HttpError(400, 'Invalid request body')
    if (!env.vapid.publicKey || !env.vapid.privateKey || !env.vapid.subject) {
      const response: SendPushResponse = {
        sent: 0,
        failed: 0,
        removed: 0,
        skipped: 'not_configured',
      }
      return json(response)
    }

    const admin: Db = createClient<Database>(env.supabaseUrl, env.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    return json(await deliver(admin, body.data.notification_ids, env))
  })
}

async function deliver(admin: Db, ids: string[], env: SendPushEnv): Promise<SendPushResponse> {
  const { data: notifications, error } = await admin
    .from('notifications')
    .select('*')
    .in('id', ids)
    .is('pushed_at', null)
  if (error) throw new Error(error.message)
  if (notifications.length === 0) return { sent: 0, failed: 0, removed: 0 }

  const userIds = [...new Set(notifications.map((n) => n.user_id))]
  const [prefs, subscriptions] = await Promise.all([
    admin.from('notification_prefs').select('*').in('user_id', userIds),
    admin.from('push_subscriptions').select('*').in('user_id', userIds),
  ])
  if (prefs.error) throw new Error(prefs.error.message)
  if (subscriptions.error) throw new Error(subscriptions.error.message)

  // Claim the rows first so a retried call doesn't push them twice.
  await admin
    .from('notifications')
    .update({ pushed_at: new Date().toISOString() })
    .in(
      'id',
      notifications.map((n) => n.id),
    )

  const deliveries = planDeliveries(notifications, prefs.data, subscriptions.data)
  const statuses = await Promise.all(
    deliveries.map(({ notification, subscription }) =>
      sendWebPush(subscription, JSON.stringify(buildMessage(notification)), env.vapid, {
        urgency: notification.kind === 'match' ? 'high' : 'normal',
        fetch: env.fetchPush,
      }).catch((e) => {
        console.error('push failed', e)
        return 0
      }),
    ),
  )

  // 404/410: the browser unsubscribed or the subscription expired.
  const gone = [
    ...new Set(
      deliveries
        .filter((_, i) => statuses[i] === 404 || statuses[i] === 410)
        .map((d) => d.subscription.id),
    ),
  ]
  if (gone.length > 0) await admin.from('push_subscriptions').delete().in('id', gone)

  const sent = statuses.filter((s) => s >= 200 && s < 300).length
  const expired = statuses.filter((s) => s === 404 || s === 410).length
  return { sent, failed: statuses.length - sent - expired, removed: gone.length }
}
