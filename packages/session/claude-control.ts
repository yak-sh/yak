// Claude's cancellation controls, shared by the importer and status readers.
import type { Bundle, Comp } from '@yaks/graph'

export let claudeStops = [
  '[Request interrupted by user]',
  '[Request interrupted by user for tool use]',
]

// Consumed logs do not replay. Older imports kept these controls as notices.
export let stoppedNotice = (b: Bundle): boolean =>
  !!b.lines && !!b.notice &&
  claudeStops.includes(String((b.content as Comp | undefined)?.body ?? ''))
