// Every model call's hold made before holds said when they expire (T-2199) is
// given the expiry and likely cost the hourly sweep settles by
// (model-spend.ts `expired`): an hour after it was made, at nothing, since
// nothing measured what the call it held for spent, and OpenAI's own bill for
// those days shows such calls cost it next to nothing. A hold made since
// without `until` is its owner's (inference.ts), and is left alone. Only the
// directory holds model reservations.
import { line } from '@yaks/query'
import type { Bundle, Comp } from '@yaks/graph'
import { PLATFORM_STORE } from '@yaks/platform/names'
import type { Rule } from './mover.ts'
import { CALL } from './meter.ts'

// When holds began to say when they expire.
let BEFORE = '2026-11-21T03:04:47.000Z'

export let holdExpiryMove = (row: Bundle): Bundle[] => {
  let at = Date.parse(String((row.created as Comp | undefined)?.at))
  let hold = row.model_reservation as Comp | undefined
  if (!hold || !Number.isFinite(at)) return []
  return [{
    entity: { eid: row.entity.eid },
    $was: { model_reservation: { until: null } },
    model_reservation: {
      ...hold,
      likely: 0,
      until: new Date(at + CALL).toISOString(),
    },
  }]
}

export let holdExpiryRule: Rule = {
  mark: 'yak/store/hold-expiry/1',
  stores: [PLATFORM_STORE],
  core: ['model_reservation'],
  live: 'all',
  find:
    line`.model_reservation&!model_reservation.until&.created.at<${BEFORE}&*`,
  move: holdExpiryMove,
}
