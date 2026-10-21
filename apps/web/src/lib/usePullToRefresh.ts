import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

// Pull down at the top of the page to refresh, like a native list. Touch only;
// a Refresh button covers mouse users. The pull is damped and capped, and
// `refresh` runs once the finger lifts past the threshold.

const THRESHOLD_PX = 70
const MAX_PULL_PX = 110

export function usePullToRefresh(target: Ref<HTMLElement | null>, refresh: () => Promise<unknown>) {
  /** How far the indicator is pulled down, in px. */
  const pull = ref(0)
  const refreshing = ref(false)
  let startY: number | null = null

  function onStart(e: TouchEvent) {
    if (refreshing.value || window.scrollY > 0 || e.touches.length !== 1) return
    startY = e.touches[0]!.clientY
  }

  function onMove(e: TouchEvent) {
    if (startY == null) return
    const dy = e.touches[0]!.clientY - startY
    if (dy <= 0) {
      pull.value = 0
      return
    }
    // Only take over the gesture while pulling down from the very top.
    if (e.cancelable) e.preventDefault()
    pull.value = Math.min(MAX_PULL_PX, dy * 0.5)
  }

  async function onEnd() {
    if (startY == null) return
    startY = null
    const go = pull.value >= THRESHOLD_PX * 0.5 + 20
    pull.value = 0
    if (go) await run()
  }

  async function run() {
    if (refreshing.value) return
    refreshing.value = true
    try {
      await refresh()
    } finally {
      refreshing.value = false
    }
  }

  onMounted(() => {
    const el = target.value
    if (!el) return
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
  })
  onBeforeUnmount(() => {
    const el = target.value
    if (!el) return
    el.removeEventListener('touchstart', onStart)
    el.removeEventListener('touchmove', onMove)
    el.removeEventListener('touchend', onEnd)
    el.removeEventListener('touchcancel', onEnd)
  })

  return { pull, refreshing, run, threshold: THRESHOLD_PX }
}
