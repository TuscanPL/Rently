import { onBeforeUnmount, onMounted } from 'vue'

// Keeps the page behind a sheet or dialog still while it's open. Pinning the
// body with position: fixed is what stops iOS Safari scrolling it under the
// finger; overflow: hidden alone doesn't. The scroll position comes back on close.

let locks = 0
let savedY = 0

function lock() {
  if (locks++ > 0) return
  savedY = window.scrollY
  const s = document.body.style
  s.position = 'fixed'
  s.top = `-${savedY}px`
  s.left = '0'
  s.right = '0'
  s.overflow = 'hidden'
}

function unlock() {
  if (--locks > 0) return
  const s = document.body.style
  s.position = ''
  s.top = ''
  s.left = ''
  s.right = ''
  s.overflow = ''
  window.scrollTo(0, savedY)
}

/** Locks page scrolling for as long as the calling component is mounted. */
export function useScrollLock() {
  onMounted(lock)
  onBeforeUnmount(unlock)
}
