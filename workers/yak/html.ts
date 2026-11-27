export { markup, raw } from '@yaks/html'
export { esc } from '@yaks/platform/escape'

// Plain dates in prose use the kit formatter, with server text in UTC.
import { day as date, pretty } from '@yaks/ui/relative'
export let day = (iso: string): string => date(iso, 'UTC')
export let moment = (iso: string): string =>
  pretty(iso, 'UTC') ? `${pretty(iso, 'UTC')} UTC` : ''

export { sentence } from '@yaks/platform/page-parts'
