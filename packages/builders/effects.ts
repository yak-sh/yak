// What a server does about builders, exported as `@yaks/builders/effects`: the
// code behind ./vocab.json's effects — check scheduled and immediate inputs,
// and write the named outputs a session answers with.
// Nothing at all when the configuration names no session to open.
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
// A configuration that names no `desk` gives them no code, which is what a
// graph that only stores builders wants rather than a session opening on a
// machine with no agent on it.
//
// `rest` is parsed when the plugin is composed, deliberately: a recurrence
// this machine cannot parse would otherwise mean a builder that never rests,
// and boot is a cheaper place to discover that than the bill. It is reported
// at boot rather than thrown — malformed configuration never stops the server
// coming up — and the plugin then gives no code.

import { type Comp, Stale, then, token } from '@yaks/graph'
import type { Handler, Handlers } from '@yaks/effects'
import type { Vocab } from '@yaks/vocab'
import { and, eq } from '@yaks/query'
import { kindOf, textOf } from '@yaks/session'
import { next, WAKE } from '@yaks/wake'
import {
  BUILD,
  clock,
  decide,
  ENTRY,
  type Open,
  type Options,
} from './build.ts'
import { answer, media } from './answer.ts'

let str = (c: unknown, k: string): string => {
  let v = (c as Comp | undefined)?.[k]
  return v == null ? '' : String(v)
}

// Build `eid` if its schedule says so and its key has changed. Every
// other case — not a builder, resting, nothing to ask, built already — is a
// builder with nothing to do right now, which is ordinary and not an error.
let stir = (o: Open): Handler => (event, tx, write) =>
  then(
    decide(o, event.entity.eid, tx, (o.now ?? clock)(), true, 'automatic'),
    (v) => v?.build ? write(v.build) : undefined,
  )

/**
 * `builder_open`, run when a builder itself changes: on `created(builder)` and
 * on `changed(builder.floor)`, so a builder created now builds now, and one
 * whose floor was moved back into the present builds then.
 *
 * It is idempotent, which is what lets its sweep replay it over every builder
 * in the graph: a second run finds the current output key, or
 * the floor it moved, and builds nothing. Its own write moves that floor, so
 * the write triggers this handler once more, and that run is the one that
 * finds the output.
 */
export let opening = (o: Open): Handler => stir(o)

/**
 * `builder_ring`, run on `created(fired)` and `changed(fired.at)`: how a
 * resting builder comes back at all. A
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

/** Recheck opted-in builders when any graph input enters, changes or leaves.
 * The query and run key decide whether that change affected a builder. The
 * run's precondition settles concurrent changes to several inputs. */
export let changing = (o: Open): Handler => async (event, tx, write) => {
  let builders = await tx.read(and(eq('builder.immediate', 'true')))
  for (let builder of builders) {
    // Creation is already builder_open's check, which respects its floor.
    if (event.kind == 'created' && builder.entity.eid == event.entity.eid) {
      continue
    }
    let v = await decide(o, builder.entity.eid, tx, (o.now ?? clock)(), false)
    if (!v?.build) continue
    try {
      await write(v.build)
    } catch (err) {
      if (!(err instanceof Stale)) throw err
    }
  }
}

/**
 * `builder_answer` turns one session answer into named graph outputs. A late
 * answer from a superseded session has no current run and writes nothing.
 */
export let answering = (vocab: Vocab): Handler => async (event, tx, write) => {
  let [said] = await tx.get([event.entity.eid])
  let session = str(said?.[ENTRY], 'session')
  if (!said || !session || !('output' in said)) return
  let [run] = await tx.read(and(eq(`${BUILD}.session`, session)))
  if (!run) return
  let [builder] = await tx.get([str(run[BUILD], 'builder')])
  let artifact = str(builder?.builder, 'format') == 'artifact'
  if (!artifact && kindOf(said) != 'output') return
  try {
    let content = artifact ? await media(tx, run, said) : textOf(said)
    return await write(await answer(tx, run, content, vocab))
  } catch (err) {
    // A bad answer cannot be the current build forever: the next check must
    // be able to retry the same key, while this error still reaches telemetry.
    await write([{
      entity: { eid: run.entity.eid },
      [BUILD]: { key: null, session: null },
      $was: { [BUILD]: { session: token(session) } },
    }])
    throw err
  }
}

/** The code that builds: a builder changing, a wake firing, an input changing,
 * and a build's session answering. */
export let watches = (o: Open): Handlers => ({
  builder_open: opening(o),
  builder_ring: ringing(o),
  builder_answer: answering(o.vocab),
  builder_change: changing(o),
})

/** The code to run, when the configuration named a session to open. */
export let effects = (
  host: { vocab: Vocab },
  options: Options = {},
): Handlers => {
  let { desk, rest } = options
  if (!desk) return {}
  if (rest && next(rest, Date.now()) == null) {
    console.warn(
      `@yaks/builders: ${JSON.stringify(rest)} is no rest — nothing builds ` +
        `until the config says how long a builder rests`,
    )
    return {}
  }
  return watches({ desk, rest, vocab: host.vocab })
}
