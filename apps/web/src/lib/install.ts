import { ref, shallowRef } from 'vue'

// "Install app": Chrome (Android, desktop) fires beforeinstallprompt once the
// manifest and service worker qualify; we keep the event and show our own
// button. iOS Safari has no such event, so we show the Add to Home Screen steps.

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export const installEvent = shallowRef<BeforeInstallPromptEvent | null>(null)
export const installed = ref(isStandalone())

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** iPhone or iPad (iPadOS reports itself as a Mac with touch). */
export function isIos(): boolean {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

/** Called from main.ts: the event can fire before any component mounts. */
export function listenForInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    installEvent.value = e as BeforeInstallPromptEvent
  })
  window.addEventListener('appinstalled', () => {
    installEvent.value = null
    installed.value = true
  })
}

export async function promptInstall() {
  const event = installEvent.value
  if (!event) return
  await event.prompt()
  const { outcome } = await event.userChoice
  // The event can only be used once.
  installEvent.value = null
  if (outcome === 'accepted') installed.value = true
}
