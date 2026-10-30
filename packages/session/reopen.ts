// `session.ended` says a session is at rest for good, until something new is
// said to it. Whatever door the words come through, input on the transcript or
// a knock or letter addressed to it, the mark goes in the same batch, so what
// was said is read and answered. A line imported from an outside harness's log
// is that harness's record, not something said to it (`session_context` clears
// the mark when the harness resumes).

import { after } from '@yaks/fp'
import type { Bundle, Comp } from '@yaks/graph/bundle'
import { hook } from '@yaks/graph/plugin'
import { and, eq, fields, list, present } from '@yaks/query'
import { SESSION } from './comp.ts'
import { kindOf } from './state.ts'

let named = (b: Bundle, comp: string, prop: string): string[] => {
  let id = (b[comp] as Comp | undefined)?.[prop]
  return typeof id == 'string' ? [id] : []
}

// The session this bundle says something to, if it does.
let addressed = (b: Bundle): string[] => [
  ...!b.lines && kindOf(b) == 'input' ? named(b, 'entry', 'session') : [],
  ...named(b, 'knock', 'target'),
  ...named(b, 'deliver', 'to'),
]

export let reopening = hook(['entry', 'knock', 'deliver'], (bundles, tx) => {
  let ids = [...new Set(bundles.flatMap(addressed))]
  if (!ids.length) return bundles
  return after(
    tx.read(and(
      eq('entity.eid', list(...ids)),
      present(`${SESSION}.ended`),
      fields('entity.eid'),
    )),
    (marked) => [
      ...bundles,
      ...marked.map((m): Bundle => ({
        entity: { eid: m.entity.eid },
        [SESSION]: { ended: null },
      })),
    ],
  )
})
