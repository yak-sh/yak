// The `yak/operator` graph facet: the rule that keeps each entity's
// `owner{person}` in the commit that makes or changes what it is read from
// (./operator-owner.ts), and the one that keeps what waits on a person's
// answer the system's to write (`answering`).
import type { Plugin } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import { dead } from '@yaks/graph/bundle'
import { after } from '@yaks/fp'
import { owning } from './operator-owner.ts'

// What waits on a person's answer: an act waiting for their tap, the asks of
// the others it was routed to, and what a stranger's conversation raised
// with them.
const WAITING = ['operator_approval', 'approval_ask', 'operator_escalation']

// What answers one of them, spends it, or moves whose it is.
const ANSWERS = [
  'decided',
  'decision',
  'filed',
  'verified',
  'declined',
  'cancelled',
]

/** Only a trusted write (the system's, and a person's own press through
 * it) writes an escalation or changes who can answer or spend an approval.
 * A caller's write, from a turn's graph_apply or a member's tool, is refused
 * whole. An act runs only when the people it was routed to press it. */
export let answering = (): Plugin => ({
  name: 'operator-answering',
  authorize: (bundles, tx, _err, context) => {
    if (context?.trusted || !bundles.length) return bundles
    if (bundles.some((b) => WAITING.some((c) => c in b))) throw refused()
    let answers = new Set(
      bundles.filter((b) => dead(b) || ANSWERS.some((c) => c in b))
        .map((b) => b.entity.eid),
    )
    return after(
      tx.get(bundles.map((b) => b.entity.eid), WAITING),
      (rows) => {
        if (
          rows.some((b) =>
            b.operator_escalation ||
            answers.has(b.entity.eid) && (b.operator_approval || b.approval_ask)
          )
        ) throw refused()
        return bundles
      },
    )
  },
})

let refused = () =>
  new Refused(
    'Only the system writes an approval, an ask or an escalation, and ' +
      'only the people it waits on answer it, by pressing it themselves.',
  )

export let plugins = (): Plugin[] => [owning(), answering()]
