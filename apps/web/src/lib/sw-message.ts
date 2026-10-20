// What the service worker (src/sw.ts) does with a push message, kept free of
// worker types so it can be unit-tested. The message comes from send-push
// (packages/edge/src/push.ts, PushMessage).

export interface ShownNotification {
  title: string
  options: NotificationOptions & { data: { url: string; notificationId?: string } }
}

const FALLBACK_TITLE = 'ApartmentTogether'

/**
 * Turns the push payload into showNotification() arguments. Unknown or broken
 * payloads still show something: a push the user can't see is wasted, and
 * Chrome shows its own generic notice when a push shows nothing.
 */
export function toNotification(raw: string | null | undefined, scope: string): ShownNotification {
  let data: Record<string, unknown> = {}
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>
  } catch {
    data = { body: raw ?? '' }
  }
  const text = (key: string) => (typeof data[key] === 'string' ? (data[key] as string) : '')

  return {
    title: text('title') || FALLBACK_TITLE,
    options: {
      body: text('body'),
      tag: text('tag') || undefined,
      icon: new URL('pwa-192.png', scope).href,
      badge: new URL('pwa-192.png', scope).href,
      data: {
        url: appUrl(text('url'), scope),
        notificationId: text('notificationId') || undefined,
      },
    },
  }
}

/** A hash route ("#/h/…") inside the app; anything pointing elsewhere opens the app root. */
export function appUrl(route: string, scope: string): string {
  if (!route.startsWith('#/')) return scope
  return new URL(route, scope).href
}
