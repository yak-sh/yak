/** Compact display counts without changing their stored precision. */
const compact = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

export const compactCount = (value: number): string =>
  value < 1000 ? String(value) : compact.format(value).toLowerCase()
