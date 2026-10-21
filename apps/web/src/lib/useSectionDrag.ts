import { onBeforeUnmount, ref } from 'vue'

// Pointer-event drag of an item onto a section, for touch and mouse alike (HTML5
// drag and drop does nothing on phones). Sections mark themselves with
// `data-drop-target="<key>"`. Touch drags start from a handle with
// `touch-action: none`, so the rest of the card still scrolls the page; a mouse
// can grab the whole card and starts dragging after a few pixels of movement.

const MOUSE_THRESHOLD_PX = 6
const EDGE_PX = 80
const MAX_SCROLL_STEP_PX = 18

export interface SectionDragOptions<T extends string> {
  onDrop(itemId: string, target: T): void
}

export function useSectionDrag<T extends string>({ onDrop }: SectionDragOptions<T>) {
  const draggingId = ref<string | null>(null)
  const overTarget = ref<T | null>(null)
  /** Where the floating ghost is drawn (viewport coordinates). */
  const ghost = ref<{ x: number; y: number; label: string } | null>(null)

  let pending: {
    id: string
    label: string
    x: number
    y: number
    el: HTMLElement
    pointerId: number
  } | null = null
  let pointerY = 0
  let scrollFrame = 0
  /** Set after a drag so the click that follows pointerup doesn't open the card. */
  let suppressClick = false

  function targetAt(x: number, y: number): T | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-target]')
    return (el?.dataset.dropTarget as T | undefined) ?? null
  }

  function autoScroll() {
    const h = window.innerHeight
    const step =
      pointerY < EDGE_PX
        ? -MAX_SCROLL_STEP_PX * (1 - pointerY / EDGE_PX)
        : pointerY > h - EDGE_PX
          ? MAX_SCROLL_STEP_PX * (1 - (h - pointerY) / EDGE_PX)
          : 0
    if (step) window.scrollBy(0, step)
    scrollFrame = requestAnimationFrame(autoScroll)
  }

  function begin() {
    if (!pending) return
    draggingId.value = pending.id
    ghost.value = { x: pending.x, y: pending.y, label: pending.label }
    try {
      pending.el.setPointerCapture(pending.pointerId)
    } catch {
      // The pointer may already be gone; the drag still ends on pointerup/cancel.
    }
    scrollFrame = requestAnimationFrame(autoScroll)
  }

  function onMove(e: PointerEvent) {
    if (!pending) return
    pointerY = e.clientY
    if (!draggingId.value) {
      const moved = Math.hypot(e.clientX - pending.x, e.clientY - pending.y)
      if (moved < MOUSE_THRESHOLD_PX) return
      begin()
    }
    e.preventDefault()
    ghost.value = { x: e.clientX, y: e.clientY, label: ghost.value?.label ?? '' }
    overTarget.value = targetAt(e.clientX, e.clientY)
  }

  function finish(e: PointerEvent, drop: boolean) {
    const id = draggingId.value
    const target = drop && id ? targetAt(e.clientX, e.clientY) : null
    stop()
    if (id) {
      suppressClick = true
      setTimeout(() => (suppressClick = false), 0)
    }
    if (id && target) onDrop(id, target)
  }

  const onUp = (e: PointerEvent) => finish(e, true)
  const onCancel = (e: PointerEvent) => finish(e, false)

  function stop() {
    pending = null
    draggingId.value = null
    overTarget.value = null
    ghost.value = null
    cancelAnimationFrame(scrollFrame)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
  }

  /**
   * Bind to pointerdown on the card (`fromHandle` false) and on its handle
   * (`fromHandle` true). Touch only drags from the handle; mouse from anywhere.
   */
  function start(e: PointerEvent, id: string, label: string, fromHandle: boolean) {
    if (e.button !== 0 || pending) return
    if (!fromHandle && e.pointerType !== 'mouse') return
    pending = {
      id,
      label,
      x: e.clientX,
      y: e.clientY,
      el: e.currentTarget as HTMLElement,
      pointerId: e.pointerId,
    }
    pointerY = e.clientY
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    // A handle drag starts at once so the finger doesn't scroll the page instead.
    if (fromHandle) {
      e.preventDefault()
      begin()
    }
  }

  /** Call from the card's click handler; true when the click ends a drag. */
  function swallowClick(): boolean {
    return suppressClick
  }

  onBeforeUnmount(stop)

  return { draggingId, overTarget, ghost, start, swallowClick }
}
