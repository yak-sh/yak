// What a server does about builders, exported as `@yaks/builders/effects`:
// build a builder when its schedule comes due, and write what a build's
// session answers into its output. Nothing at all when the configuration names
// no session to open.
//
// That session is why this export takes OPTIONS. Opening one means asking a
// provider, at an effort, with a persona — an account, a model and a persona
// that exist on this machine — and none of that is a fact about the graph. So
// the configuration names what to open and this package decides when:
//
// ```json
// { "use": "@yaks/builders",
//   "with": { "desk": { "provider": "Y-openai",
//                       "model": "O-gpt-6",
//                       "effort": "high",
//                       "persona": "N-scribe",
//                       "actor": "N-scribe",
//                       "ask": "Write up what is waiting." },
//             "rest": "1h" } }
// ```
//
// A configuration that names no `desk` registers no watches, which is what a
// graph that only stores builders wants rather than a session opening on a
// machine with no agent on it.
//
// `rest` is parsed when the plugin is composed, deliberately: a recurrence
// this machine cannot parse would otherwise mean a builder that never rests,
// and boot is a cheaper place to discover that than the bill. It is reported
// at boot rather than thrown — malformed configuration never stops the server
// coming up — and the plugin then registers nothing.

import { type Comp, then } from '@yaks/graph'
import type { Handler, Watch } from '@yaks/effects'
import type { Vocab } from '@yaks/vocab'
import { DOC } from '@yaks/doc'
import { and, eq } from '@yaks/query'
import { kindOf, OUTPUT, textOf } from '@yaks/session'
import { FIRED, next, WAKE } from '@yaks/wake'
import {
  BUILDER,
  BUILT,
  clock,
  decide,
  ENTRY,
  type Open,
  type Options,
} from './build.ts'

let str = (c: unknown, k: string): string => {
  let v = (c as Comp | undefined)?.[k]
  return v == null ? '' : String(v)
}

// Build `eid` if its schedule says so and its key is not built yet. Every
// other case — not a builder, resting, nothing to ask, built already — is a
// builder with nothing to do right now, which is ordinary and not an error.
let stir = (o: Open): Handler => (event, tx, write) =>
  then(
    decide(o, event.entity.eid, tx, (o.now ?? clock)()),
    (v) => v?.build ? write(v.build) : undefined,
  )

/**
 * The handler that runs when a builder itself changes: registered on
 * `created(builder)` and on `changed(builder.floor)`, so a builder created now
 * builds now, and one whose floor was moved back into the present builds then.
 *
 * It is idempotent, which is what lets a boot reconciliation replay it over
 * every builder in the graph: a second run finds the output under the key, or
 * the floor it moved, and builds nothing. Its own write moves that floor, so
 * the write triggers this handler once more, and that run is the one that
 * finds the output.
 */
export let opening = (o: Open): Handler => stir(o)

/**
 * The handler a wake runs: registered on `created(fired)` and
 * `changed(fired.at)`, it is how a resting builder comes back at all. A
 * recurring @yaks/wake `wake` on the builder — or one aimed at it through
 * `wake.target` — fires, and the builder is checked again.
 */
export let ringing = (o: Open): Handler => (event, tx, write) =>
  then(tx.get([event.entity.eid]), (found) =>
    stir(o)(
      {
        ...event,
        entity: { eid: str(found[0]?.[WAKE], 'target') || event.entity.eid },
      },
      tx,
      write,
    ))

/**
 * The handler that fills an output: when a build's session answers, the
 * answer becomes the output's `doc` body. Each answer replaces the last, so
 * what the output holds once the session settles is what it said last.
 */
export let answering: Handler = (event, tx, write) =>
  then(tx.get([event.entity.eid]), (found) => {
    let said = found[0]
    let session = str(said?.[ENTRY], 'session')
    if (!said || !session || kindOf(said) != 'output') return
    return then(
      tx.read(and(eq(`${BUILT}.session`, session))),
      (outs) =>
        outs.length
          ? write(outs.map((b) => ({
            entity: { eid: b.entity.eid },
            [DOC]: { body: textOf(said) },
          })))
          : undefined,
    )
  })

/** The watches that build: a builder changing, a wake firing on one, and a
 * build's session answering. */
export let watches = (o: Open): Watch[] => [
  {
    comp: BUILDER,
    created: opening(o),
    changed: { floor: opening(o) },
    // The handler builds nothing for a builder that is resting or built under
    // its key, so replaying it over every builder at boot is safe: what a
    // crash interrupted is picked up, and what it did not is left alone.
    sweep: { pending: `.${BUILDER}` },
    doc: 'build a builder whose floor has passed, unless its key is built',
  },
  {
    comp: FIRED,
    created: ringing(o),
    changed: { at: ringing(o) },
    doc: 'a wake fired on a builder: check whether it is due',
  },
  {
    comp: OUTPUT,
    created: answering,
    doc: "a build's session answered: the answer is the output's body",
  },
]

/** The watches to register, when the configuration named a session to
 * open. */
export let effects = (
  host: { vocab: Vocab },
  options: Options = {},
): Watch[] => {
  let { desk, rest } = options
  if (!desk) return []
  if (rest && next(rest, Date.now()) == null) {
    console.warn(
      `@yaks/builders: ${JSON.stringify(rest)} is no rest — nothing builds ` +
        `until the config says how long a builder rests`,
    )
    return []
  }
  return watches({ desk, rest, vocab: host.vocab })
}
