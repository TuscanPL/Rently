/// <reference lib="webworker" />
// The service worker, built by vite-plugin-pwa (strategies: 'injectManifest').
// It precaches the app shell like the generated worker did, serves index.html
// for navigations (the share target opens "<base>?url=…#/add"), and shows Web
// Push notifications sent by the send-push edge function.
import { clientsClaim } from 'workbox-core'
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { toNotification } from './lib/sw-message'

declare const self: ServiceWorkerGlobalScope

// registerType: 'autoUpdate': a new worker takes over right away.
void self.skipWaiting()
clientsClaim()

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

self.addEventListener('push', (event) => {
  const { title, options } = toNotification(event.data?.text(), self.registration.scope)
  event.waitUntil(self.registration.showNotification(title, options))
})

// Focus an open window of the app and route it, or open a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url: string = event.notification.data?.url ?? self.registration.scope
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const client = windows.find((w) => w.url.startsWith(self.registration.scope))
      if (client) {
        await client.focus()
        // Only the hash changes, so this is an in-app navigation, not a reload.
        await client.navigate(url).catch(() => client.postMessage({ type: 'navigate', url }))
        return
      }
      await self.clients.openWindow(url)
    })(),
  )
})
