// The runner: a transcript run until it has nothing more to do, in whichever
// process claims the run. There is one runner, and it runs wherever the effects
// role does — a box's `yak serve`, a command's duty thread, a store object on
// Cloudflare — because it is not a loop in anybody's process. It is the code
// behind `session_run`, an effect this package declares (./vocab.json): a
// commit that asks a transcript for a turn writes the run it owes into the
// graph, and any process working the pool (@yaks/effects) claims it.
//
// What asks for a turn is a `using` on an entry: the request @yaks/spawn
// answers when the provider is a command line, and this answers when it is a
// provider the host lent a model for ({@link Runner.answers}). A child
// admitted to run (`dispatch.state`), a task a transcript holds completing or
// being cancelled, and a dependency of that task going away owe a run too; a
// worker coming up sweeps every transcript a restart left owing one.
//
// A run is serialized twice. In one process, a trigger for a transcript that
// is already being run marks the pass to look again instead of starting a
// second. Across processes, a run holds a lease named for the transcript
// (@yaks/effects `holding`), renewed while it runs; a run that finds it held
// leaves the transcript to the holder, which looks again after letting go, so
// an entry that landed just as it finished is never left unanswered.
//
// Children share one bound (`maxChildren`, @yaks/session `ChildLimits`): a
// spawned transcript waits `queued` until fewer than that many are `active`,
// and one ending admits the oldest waiting (./admission.ts). Admission is a
// write to the child's `dispatch`, which owes it a run like any other request.
//
// A process leaving (`stopping`) starts no step after it and lets the step in
// flight finish; what is left is owed, for the next worker's sweep.
//
// What the runner is lent — the models, the tools, the limits — is the host's
// ({@link Runner}): nothing here names a machine or a provider.

import type { Event, Handlers } from '@yaks/effects'
import { HOLD, holding } from '@yaks/effects'
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { active, admitNext, queue, swap } from './admission.ts'
import { type ChildLimits, deliverChild } from './children.ts'
import { STOP_ENTRY } from './native.ts'
import { type Deps, react, type Step, transcript } from './react.ts'
import {
  seqOf,
  statusOf,
  type TranscriptStatus,
  usingBefore,
} from './status.ts'

/** What a host lends the runner: how a step is taken (./react.ts `Deps`), the
 * bound on children, and who is running it. */
export type Runner = Deps & ChildLimits & {
  /** the process running it: what a transcript's lease names as its holder,
   * so it must be an entity in the graph */
  holder: Eid
  /** whether this host answers a transcript asking with this `using`
   * (./providers.ts `answers`); one it does not is left to whoever does */
  answers?: (using: Comp | undefined) => boolean | Promise<boolean>
  /** each step, as it lands */
  each?: (step: Step) => void
  /** how long a transcript's lease stands between renewals (ms) */
  hold?: number
  /** whether a holder of a transcript's lease is known to have ended without
   * letting go, so its run is had now (@yaks/effects `HoldOpts.gone`) */
  gone?: (holder: Eid) => boolean | Promise<boolean>
  /** how often a running step looks for a withdrawal of its request (ms) */
  look?: number
}

/** What a transcript's lease is named under: `@yaks/session/run/<eid>`. */
export let RUN = '@yaks/session/run'

let ENDED: TranscriptStatus[] = ['settled', 'failed', 'stopped']

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

let one = async (g: Graph, eid: Eid): Promise<Bundle | undefined> =>
  (await g.get([eid]))[0]

// The newest entry's seq: how a run tells, after letting go, whether anything
// landed since it last looked.
let newest = async (g: Graph, session: Eid): Promise<number> => {
  let [last] = await g.read(
    `.entry.session=${session}&.order=-entry.seq&.limit=1&*`,
  )
  return last ? seqOf(last) : 0
}

// A task this transcript holds was cancelled: the transcript is stopped, once.
let quit = async (g: Graph, session: Eid, entries: Bundle[]) => {
  if (!g.vocab.comps.includes('task')) return entries
  let held = await g.read(`.task&.claim.session=${session}&.cancelled`)
  if (!held.length || statusOf(entries) == 'stopped') return entries
  await g.apply([{
    entity: { eid: `${session}:cancelled` },
    entry: { session },
    [STOP_ENTRY]: {},
  }], { trusted: true })
  return transcript(g, session)
}

// A transcript that has ended: its parent told, its dispatch settled, and its
// place among the children given to the next. The parent is told first, so a
// run cut short between the two leaves the child still `active`, which the
// sweep of a worker coming up runs again, and telling is idempotent.
let ended = async (g: Graph, session: Eid, r: Runner) => {
  let self = await one(g, session)
  let d = comp(self, 'dispatch')
  if (self?.spawned) await deliverChild(g, session)
  if (!d || d.state == 'settled') return
  await g.apply(
    [{ entity: { eid: session }, dispatch: { state: 'settled' } }],
    {
      trusted: true,
    },
  )
  await admitNext(g, r)
}

// Whether a child may run now. One without a `dispatch` is a root and always
// may; a queued one runs once it is among the oldest the bound leaves room
// for; a settled one given more to do rejoins the tail. A child's preparation
// (a checkout of its own, say) is done once, by the run that admits it.
let admitted = async (g: Graph, session: Eid, r: Runner) => {
  let self = await one(g, session)
  let d = comp(self, 'dispatch')
  if (!self || !d) return true
  if (d.state == 'settled') {
    let order = Math.max(
      0,
      ...(await g.read('.dispatch')).map((b) =>
        Number(comp(b, 'dispatch')?.order ?? 0)
      ),
    ) + 1
    await swap(g, session, 'settled', { state: 'queued', order })
    return false
  }
  if (d.state == 'queued') {
    let free = (r.maxChildren ?? 32) - await active(g)
    let ahead = (await queue(g)).findIndex((b) => b.entity.eid == session)
    if (ahead < 0 || ahead >= free) return false
    if (!await swap(g, session, 'queued', { state: 'active' })) return false
  }
  if (typeof d.args != 'string') return true
  try {
    let prepared = await r.prepareChild?.({
      parent: String(comp(self, 'spawned')?.parent),
      child: session,
      args: JSON.parse(d.args),
    }) ?? {}
    await g.apply([{
      entity: { eid: session },
      ...prepared,
      dispatch: { state: 'active', args: null },
    }], { trusted: true })
    return true
  } catch (err) {
    r.report?.(err, session, 'prepare')
    await g.apply([{
      entity: { eid: session },
      dispatch: { args: null },
    }, {
      entity: { eid: `${session}:preparation-error` },
      entry: { session },
      exception: {},
      content: { body: String(err) },
    }, {
      entity: { eid: `${session}:preparation-stop` },
      entry: { session },
      [STOP_ENTRY]: {},
    }], { trusted: true })
    await ended(g, session, r)
    return false
  }
}

// Whether a request in flight has been withdrawn: a `cancel` entry in the
// transcript naming an attempt that is still in flight.
let withdrawn = async (g: Graph, session: Eid): Promise<boolean> => {
  let said = await g.read(`.entry.session=${session}&.cancel&*`)
  if (!said.length) return false
  let targets = said.map((b) => String(comp(b, 'cancel')?.target))
  let found = await g.get(targets)
  return found.some((b) => comp(b, 'attempt')?.state == 'inflight')
}

// One step, aborted if its request is withdrawn while it runs.
let step = async (g: Graph, session: Eid, r: Runner): Promise<Step> => {
  let stop = new AbortController()
  let signal = r.signal ? AbortSignal.any([r.signal, stop.signal]) : stop.signal
  // Only a streamed request is in flight as an attempt a cancel can name.
  let look = r.streaming
    ? setInterval(() => {
      withdrawn(g, session).then(
        (yes) => yes && stop.abort(),
        (err) => r.report?.(err, session, 'withdrawal'),
      )
    }, r.look ?? 1000)
    : undefined
  try {
    return await react(g, session, { ...r, signal })
  } finally {
    clearInterval(look)
  }
}

// The steps a held transcript takes: until one does nothing, or it ends.
// Answers the newest seq it saw.
let turns = async (g: Graph, session: Eid, r: Runner): Promise<number> => {
  let entries = await quit(g, session, await transcript(g, session))
  if (ENDED.includes(statusOf(entries))) {
    await ended(g, session, r)
    return newest(g, session)
  }
  if (!await admitted(g, session, r)) return newest(g, session)
  while (!r.stopping?.aborted) {
    let s = await step(g, session, r)
    r.each?.(s)
    if (ENDED.includes(s.status)) {
      await ended(g, session, r)
      break
    }
    if (s.did == 'nothing') break
  }
  return newest(g, session)
}

// The transcript's lease, taken for one run and renewed while it goes; a
// lease another process takes from it stops the run between steps, as leaving
// does. Answers the newest seq the run saw, or `null` where somebody else
// holds it.
let held = async (
  g: Graph,
  session: Eid,
  r: Runner,
): Promise<number | null> => {
  let seen = await holding(g, `${RUN}/${session}`, {
    holder: r.holder,
    hold: r.hold ?? HOLD,
    gone: r.gone,
    signal: r.stopping ?? new AbortController().signal,
    wait: false,
    report: (err) => r.report?.(err, session, 'lease'),
  }, (stopping) => turns(g, session, { ...r, stopping }))
  return seen ?? null
}

// Whether something landed after `seen` that the transcript owes a turn for.
let owed = async (g: Graph, session: Eid, seen: number) => {
  if (await newest(g, session) <= seen) return false
  let status = statusOf(await transcript(g, session))
  return status == 'pending' || status == 'running'
}

type Pass = { again: boolean; done: Promise<void> }
let passes = new WeakMap<Graph, Map<Eid, Pass>>()
let going = (g: Graph) => {
  let here = passes.get(g)
  if (!here) passes.set(g, here = new Map())
  return here
}

/**
 * Run a transcript until it has nothing more to do: every step it is owed,
 * under its lease. Where this process is already running it, the pass going
 * looks again when it is done, and this answers when that pass does; where
 * another process holds it, this answers at once.
 *
 * ```ts
 * import { settle } from '@yaks/session'
 *
 * // await settle(graph, session, { holder: me, model, tools })
 * ```
 */
export let settle = (g: Graph, session: Eid, r: Runner): Promise<void> => {
  let here = going(g)
  let pass = here.get(session)
  if (pass) {
    pass.again = true
    return pass.done
  }
  let p: Pass = { again: true, done: Promise.resolve() }
  here.set(session, p)
  p.done = (async () => {
    try {
      while (p.again && !r.stopping?.aborted) {
        p.again = false
        let seen = await held(g, session, r)
        if (seen == null) return
        if (await owed(g, session, seen)) p.again = true
      }
    } finally {
      here.delete(session)
    }
  })()
  return p.done
}

/** Whether a transcript is being run by this process right now. */
export let runningHere = (g: Graph, session: Eid): boolean =>
  going(g).has(session)

/** The pass this process is running over a transcript, to wait on, if any. */
export let passing = (g: Graph, session: Eid): Promise<void> | undefined =>
  going(g).get(session)?.done

// The transcripts an event owes a run: the one an entry is in (not a turn the
// runner itself took, which the run that wrote it carries on from), a
// transcript itself (admitted, or swept up), or those holding a task that
// completed or was cancelled, or holding one that contains or requires it.
let about = async (g: Graph, e: Event): Promise<Eid[]> => {
  let b = await one(g, e.entity.eid)
  if (b?.entry) return b.ask ? [] : [String(comp(b, 'entry')?.session)]
  if (b?.session) return [b.entity.eid]
  if (!g.vocab.comps.includes('task')) return []
  let tasks = new Set<Eid>()
  if (b?.task) tasks.add(b.entity.eid)
  let edge = comp(b, 'edge')
  for (let end of [edge?.from, edge?.to]) if (end) tasks.add(String(end))
  // A dependency edge that went away with its entity has no before-image to
  // follow, so every task a transcript holds is looked at again.
  let held = b
    ? []
    : (await g.read('.task&.claim.session&*')).map((t) => t.entity.eid)
  for (let t of [...tasks]) {
    for (let rel of ['contains', 'requires']) {
      for (let x of await g.read(`.${rel}&.edge.to=${t}&*`)) {
        tasks.add(String(comp(x, 'edge')?.from))
      }
    }
  }
  let rows = await g.get([...tasks, ...held])
  return [
    ...new Set(
      rows.map((t) => comp(t, 'claim')?.session)
        .filter((s): s is string => typeof s == 'string'),
    ),
  ]
}

/** Whether this runner answers a transcript: it asked for turns (a `using` or
 * an `ask` on an entry), and its `using` in force names a provider the runner
 * was lent a model for. */
export let answering = async (
  g: Graph,
  session: Eid,
  r: Runner,
): Promise<boolean> => {
  let asked = await g.read(`.entry.session=${session}&.using&*`)
  let entries = asked.length ? asked : await transcript(g, session)
  if (!entries.some((b) => b.using || b.ask)) return false
  return r.answers ? await r.answers(usingBefore(entries)) : true
}

/** Answer a transcript's request for a turn here, where this host answers the
 * provider it asks for: {@link settle} it, or, where this process is already
 * running it, have that pass look again (without waiting on it, since the
 * pass may be what is asking; whoever started the pass hears how it ends). */
export let answer = async (
  g: Graph,
  session: Eid,
  r: Runner,
): Promise<void> => {
  if (runningHere(g, session)) {
    return void settle(g, session, r).catch(() => {})
  }
  if (await answering(g, session, r)) await settle(g, session, r)
}

/**
 * The code behind `session_run`, for a host's `./effects` facet: every
 * transcript a commit asked for a turn, run here by {@link settle} where this
 * host answers the provider it asks for.
 *
 * ```ts
 * import { answers, running } from '@yaks/session'
 *
 * // export let effects = (host) => running(host.graph, { holder: host.me, … })
 * ```
 */
export let running = (g: Graph, r: Runner): Handlers => ({
  session_run: async (e) => {
    for (let session of await about(g, e)) await answer(g, session, r)
  },
})
