// The `yak/operator` graph facet: the rule that keeps each entity's
// `owner{person}` in the commit that makes or changes what it is read from
// (./operator-owner.ts), and the one that keeps what waits on a person's
// answer the system's to write (`answering`).
import type { Bundle, Plugin } from '@yaks/graph'
import { hook } from '@yaks/graph/plugin'
import { Refused } from '@yaks/graph/errors'
import { dead, TOMBSTONE } from '@yaks/graph/bundle'
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
 * it) writes what waits on a person's answer, or answers, spends, moves or
 * deletes one. A caller's write, from a turn's graph_apply, a member's tool
 * or any door that writes as its caller, is refused whole: an act runs only
 * when the people it was routed to press it themselves. */
export let answering = (): Plugin => ({
  name: 'operator-answering',
  authorize: hook(
    [...WAITING, ...ANSWERS, '$delete', TOMBSTONE],
    (bundles, tx, _err, context) => {
      if (context?.trusted) return bundles
      let shaping = (b: Bundle) => WAITING.some((c) => c in b)
      if (bundles.some(shaping)) throw refused()
      let touching = bundles.filter((b) =>
        dead(b) || ANSWERS.some((c) => c in b)
      )
      if (!touching.length) return bundles
      return after(
        tx.get(touching.map((b) => b.entity.eid), WAITING),
        (rows) => {
          if (rows.some((b) => WAITING.some((c) => b[c] != null))) {
            throw refused()
          }
          return bundles
        },
      )
    },
  ),
})

let refused = () =>
  new Refused(
    'Only the system writes an approval, an ask or an escalation, and ' +
      'only the people it waits on answer it, by pressing it themselves.',
  )

export let plugins = (): Plugin[] => [owning(), answering()]
