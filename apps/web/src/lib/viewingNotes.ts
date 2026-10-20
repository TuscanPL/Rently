import type { ViewingRating } from '@at/shared'

/** How each post-viewing rating looks: picked button and the chip in the thread. */
export const RATING_STYLES: Record<ViewingRating, { icon: string; active: string; chip: string }> =
  {
    good: {
      icon: '👍',
      active: 'border-emerald-400 bg-emerald-100 text-emerald-800',
      chip: 'bg-emerald-100 text-emerald-800',
    },
    ok: {
      icon: '😐',
      active: 'border-amber-400 bg-amber-100 text-amber-800',
      chip: 'bg-amber-100 text-amber-800',
    },
    bad: {
      icon: '👎',
      active: 'border-rose-400 bg-rose-100 text-rose-800',
      chip: 'bg-rose-100 text-rose-800',
    },
  }
