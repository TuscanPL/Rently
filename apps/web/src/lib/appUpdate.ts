import { ref } from 'vue'
import { registerSW } from 'virtual:pwa-register'

// Keeping the installed app current. Phones keep a PWA suspended rather than
// closing it, so besides the browser's own check on launch we look for a new
// version whenever the app comes back to the foreground and every half hour.
// A new version is installed in the background and waits; the UpdateBanner
// asks before switching, so nobody is reloaded in the middle of typing.

const CHECK_EVERY_MS = 30 * 60_000
/** Coming back to the app checks at most this often. */
const MIN_GAP_MS = 60_000

export const APP_VERSION = __APP_VERSION__
export const BUILD_TIME = __BUILD_TIME__

/** A new version is installed and waiting for the user to switch to it. */
export const updateReady = ref(false)
export const checking = ref(false)

let registration: ServiceWorkerRegistration | undefined
let activate: ((reload?: boolean) => Promise<void>) | undefined
let lastCheck = 0

export function startUpdateChecks() {
  activate = registerSW({
    immediate: true,
    onNeedRefresh: () => (updateReady.value = true),
    onRegisteredSW(_url, reg) {
      registration = reg
      if (reg?.waiting) updateReady.value = true
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && Date.now() - lastCheck > MIN_GAP_MS) {
          void checkForUpdate()
        }
      })
      setInterval(() => void checkForUpdate(), CHECK_EVERY_MS)
    },
  })
}

function installed(worker: ServiceWorker): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      if (worker.state === 'installed' || worker.state === 'redundant') resolve()
    }
    worker.addEventListener('statechange', done)
    done()
  })
}

/**
 * Asks the server for a newer version. 'ready': one is installed and waiting;
 * 'current': this is the latest; 'unavailable': no service worker (dev, an
 * unsupported browser) or offline.
 */
export async function checkForUpdate(): Promise<'ready' | 'current' | 'unavailable'> {
  if (!registration || !navigator.onLine) return 'unavailable'
  lastCheck = Date.now()
  checking.value = true
  try {
    await registration.update()
    if (registration.installing) await installed(registration.installing)
  } catch {
    return 'unavailable'
  } finally {
    checking.value = false
  }
  if (registration.waiting) updateReady.value = true
  return updateReady.value ? 'ready' : 'current'
}

/** Switches to the waiting version; the page reloads once it has taken over. */
export async function applyUpdate() {
  await activate?.(true)
}
