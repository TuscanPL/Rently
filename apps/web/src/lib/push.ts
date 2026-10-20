import { supabase } from '@/lib/supabase'

// Web Push on this device: the browser's PushManager subscription, stored in
// public.push_subscriptions so the send-push edge function can reach it.

export type PushSupport =
  /** Ready to subscribe. */
  | 'ok'
  /** No Push API here. On iPhone/iPad it appears once the app is on the home screen. */
  | 'unsupported'
  /** The build has no VITE_VAPID_PUBLIC_KEY. */
  | 'unconfigured'
  /** The user blocked notifications for this site. */
  | 'denied'

const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY

export function pushSupport(): PushSupport {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    return 'unsupported'
  if (!vapidKey) return 'unconfigured'
  if (Notification.permission === 'denied') return 'denied'
  return 'ok'
}

/** The app's service worker. Missing in `pnpm dev`, where vite-plugin-pwa doesn't register one. */
async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
  if (!reg) throw new Error('No service worker: push works in the built app only.')
  await navigator.serviceWorker.ready
  return reg
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null
  const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
  return (await reg?.pushManager.getSubscription()) ?? null
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

/** Asks for permission (must run from a tap), subscribes and saves the subscription. */
export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('permission')
  const reg = await registration()
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(vapidKey!),
    }))
  const json = sub.toJSON()
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh ?? '',
    p_auth: json.keys?.auth ?? '',
    p_user_agent: navigator.userAgent,
  })
  if (error) throw error
}

/** Unsubscribes this browser and forgets the subscription. */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
}
