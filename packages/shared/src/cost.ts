export interface ListingCosts {
  rent?: number | null
  adminFee?: number | null
  utilitiesEstimate?: number | null
}

/** czynsz + opłaty: rent + admin fee + utilities. Null when rent is unknown. */
export function totalMonthly(c: ListingCosts): number | null {
  if (c.rent == null) return null
  return c.rent + (c.adminFee ?? 0) + (c.utilitiesEstimate ?? 0)
}

export function costPerM2(c: ListingCosts & { areaM2?: number | null }): number | null {
  const total = totalMonthly(c)
  if (total == null || !c.areaM2) return null
  return total / c.areaM2
}

const plnFormatter = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  maximumFractionDigits: 0,
  // Polish CLDR skips grouping below 10 000; listing sites write "4 450 zł".
  useGrouping: 'always',
})

export function formatPLN(value: number | null | undefined): string {
  return value == null ? '—' : plnFormatter.format(value)
}

const areaFormatter = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 })

export function formatArea(m2: number | null | undefined): string {
  return m2 == null ? '—' : `${areaFormatter.format(m2)} m²`
}
