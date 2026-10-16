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
// admitted to run (`admitted`, or legacy `dispatch.state`), a task a transcript holds completing or
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
// A model request the provider failed but may yet answer ends the run: the
// step records it and throws, and the pool runs it again after its backoff, up
// to `session_run`'s tries (@yaks/effects `Attempt`). A step that gets
// somewhere gives the run its tries back, so a run going for hours counts the
// failures in a row, not all it ever met (T-62140).
//
// What the runner is lent — the models, the tools, the limits — is the host's
// ({@link Runner}): nothing here names a machine or a provider.

import type { Event, Handlers } from '@yaks/effects'
import { held as lease, HOLD, holding } from '@yaks/effects'
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import { effectsIn } from '@yaks/vocab'
import { actionable, exceptionOf } from '@yaks/tools/fault'
import { dependents } from '@yaks/task'
import {
  active,
  admitNext,
  dispatchStatus,
  queue,
  swap,
  tail,
} from './admission.ts'
import { type ChildLimits, deliverChild } from './children.ts'
import { CLAIM } from './comp.ts'
import { STOP_ENTRY } from './native.ts'
import {
  currentStatus,
  type Deps,
  react,
  statusEntries,
  type Step,
} from './react.ts'
import { seqOf, type TranscriptStatus, usingBefore } from './state.ts'
import { cleanEnd, requested, unlinked, waits, wake } from './wake.ts'

/** What a host lends the runner: how a step is taken (./react.ts `Deps`), the
 * bound on children, and who is running it. */
export type Runner = Deps & ChildLimits & {
  /** the process running it: what a transcript's lease names as its holder,
   * so it must be an entity in the graph */
  holder: Eid
  /** whether this host answers a transcript asking with this `using`
   * (./providers.ts `answers`); one it does not is left to whoever does */
  answers?: (
    using: Comp | undefined,
    session?: Eid,
  ) => boolean | Promise<boolean>
  /** each step, as it lands */
  each?: (step: Step) => void
  /** reconcile borrowed resources after this pass releases its lease */
  idle?: (session: Eid) => Promise<void>
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

let one = async (
  g: Graph,
  eid: Eid,
  names: string[],
): Promise<Bundle | undefined> =>
  (await g.get([eid], names.filter((name) => g.vocab.comp(name))))[0]

// Routing needs presence, not a session's computed status and transcript cost.
let isSession = async (g: Graph, eid: Eid): Promise<boolean> =>
  Number((await g.rows(`.entity.eid=${eid}&.session&.count`))[0]?.n ?? 0) > 0

let admission = ['spawned', 'dispatch', 'admitted', 'waiting']

type Seen = { seq: number; waiting?: Step['waiting'] }

// The newest entry's seq, with the receipt checked by a hosted pending step:
// receipt mutations leave entry positions unchanged.
let newest = async (g: Graph, session: Eid): Promise<Seen> => {
  let [last] = await g.read(
    `.entry.session=${session}&.order=-entry.seq&.limit=1`,
  )
  return { seq: last ? seqOf(last) : 0 }
}

// Whether transcripts here can hold tasks at all: a graph that has tasks and
// no claims (an app's store) has no task a transcript could be holding.
let holds = (g: Graph) =>
  g.vocab.comps.includes('task') && g.vocab.comps.includes(CLAIM)

// A transcript that has ended: its parent told, its dispatch settled, and its
// place among the children given to the next. The parent is told first, so a
// run cut short between the two leaves the child still `active`, which the
// sweep of a worker coming up runs again, and telling is idempotent.
let ended = async (g: Graph, session: Eid, r: Runner) => {
  if (g.vocab.comp('provisional')) {
    let owed = await g.read(`.entry.session=${session}&.ask&.provisional`)
    if (owed.length) {
      await g.apply(
        owed.map((b) => ({
          entity: b.entity,
          provisional: null,
        })),
        { trusted: true },
      )
    }
  }
  let self = await one(g, session, admission)
  let d = comp(self, 'dispatch')
  if (self?.spawned) await deliverChild(g, session)
  if (!d || dispatchStatus(self) == 'settled') return
  await swap(g, session, dispatchStatus(self), { state: 'settled' })
  await admitNext(g, r)
}

// Whether a child may run now. One without `spawned` is a root and always
// may; a queued one runs once it is among the oldest the bound leaves room
// for; a settled one given more to do rejoins the tail. A child's preparation
// (a checkout of its own, say) is done once, by the run that admits it.
let admitted = async (g: Graph, session: Eid, r: Runner) => {
  let self = await one(g, session, admission)
  let d = comp(self, 'dispatch')
  if (!self?.spawned) return true
  if (!d) {
    // Imports can have spawned{parent,call}. The pool's canonical native input
    // identifies a returning child by convention, not as a security boundary.
    let input = await one(g, `${session}:input`, [
      'entry',
      'content',
      'using',
      'imported',
      'output',
      'call',
      'result',
    ])
    if (
      comp(input, 'entry')?.session != session || !input?.using ||
      !input.content || input.imported || input.output || input.call ||
      input.result
    ) return true
    try {
      await g.apply([{
        entity: { eid: session },
        // Expansion writers retain legacy state until the explicit cutover.
        dispatch: { state: 'queued', order: await tail(g) },
        $was: {
          dispatch: { state: null, args: null, order: null },
          spawned: {
            parent: token(comp(self, 'spawned')?.parent),
            call: token(comp(self, 'spawned')?.call),
          },
        },
      }, {
        entity: input.entity,
        $was: Object.fromEntries(
          ['entry', 'content', 'using', 'imported', 'output', 'call', 'result']
            .filter((name) => g.vocab.comps.includes(name))
            .map((name) => [
              name,
              Object.fromEntries(
                g.vocab.props(name)
                  .filter((prop) => !g.vocab.prop(name, prop)?.computed)
                  .map((prop) => [prop, token(comp(input, name)?.[prop])]),
              ),
            ]),
        ),
      }], { trusted: true })
    } catch (error) {
      if (error instanceof Stale) return false
      throw error
    }
    self = await one(g, session, admission)
    d = comp(self, 'dispatch')
  }
  if (dispatchStatus(self) == 'settled') {
    let order = await tail(g)
    if (!await swap(g, session, 'settled', { state: 'queued', order })) {
      return false
    }
    self = await one(g, session, admission)
  }
  // A live wait owns this lease. Recovery has lost its reacquisition closure,
  // so requeue then attempt bounded admission in this same pass (no lost wake).
  if (dispatchStatus(self) == 'waiting') {
    if (!await swap(g, session, 'waiting', { state: 'queued' })) return false
    self = await one(g, session, admission)
  }
  if (dispatchStatus(self) == 'queued') {
    let free = (r.maxChildren ?? 32) - await active(g)
    let ahead = (await queue(g)).findIndex((b) => b.entity.eid == session)
    if (ahead < 0 || ahead >= free) return false
    if (!await swap(g, session, 'queued', { state: 'active' })) return false
  }
  if (typeof d?.args != 'string') return true
  try {
    let prepared = await r.prepareChild?.({
      parent: String(comp(self, 'spawned')?.parent),
      child: session,
      args: JSON.parse(d.args),
    }) ?? {}
    await g.apply([{
      entity: { eid: session },
      ...prepared,
      dispatch: { args: null },
    }], { trusted: true })
    return true
  } catch (err) {
    if (actionable(String(exceptionOf(err).value))) {
      r.report?.(err, session, 'prepare')
    }
    await g.apply([{
      entity: { eid: session },
      dispatch: { args: null },
    }, {
      entity: { eid: `${session}:preparation-error` },
      entry: { session },
      exception: exceptionOf(err),
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

// How each step in flight here looks for a withdrawal of its request, by
// transcript. A cancel written to a transcript owes it a run, and a run owed
// where one is going looks at once (`answer`), so a withdrawal written in this
// process lands now; one written elsewhere is seen on the next tick.
let looks = new WeakMap<Graph, Map<Eid, () => void>>()
let looking = (g: Graph) => {
  let here = looks.get(g)
  if (!here) looks.set(g, here = new Map())
  return here
}

// One step, aborted if its request is withdrawn while it runs.
let step = async (g: Graph, session: Eid, r: Runner): Promise<Step> => {
  let stop = new AbortController()
  let signal = r.signal ? AbortSignal.any([r.signal, stop.signal]) : stop.signal
  let look = () =>
    void withdrawn(g, session).then(
      (yes) => yes && stop.abort(),
      (err) => r.report?.(err, session, 'withdrawal'),
    )
  // Only a streamed request is in flight as an attempt a cancel can name.
  let tick = r.streaming ? setInterval(look, r.look ?? 1000) : undefined
  if (r.streaming) looking(g).set(session, look)
  try {
    return await react(g, session, { ...r, owner: r.holder, signal })
  } finally {
    clearInterval(tick)
    if (looking(g).get(session) == look) looking(g).delete(session)
  }
}

// The steps a held transcript takes: until one does nothing, or it ends.
// Answers the newest seq it saw.
let turns = async (g: Graph, session: Eid, r: Runner): Promise<Seen> => {
  // A terminal transcript owes no model step. Use the already-derived fact
  // before loading all entry marks; old unresolved calls still keep settled
  // transcripts runnable and are queried explicitly when that matters.
  let status = await currentStatus(g, session)
  let held = holds(g)
    ? await g.read(`.task&.claim.session=${session}&.cancelled`)
    : []
  if (held.length && status != 'stopped') {
    await g.apply([{
      entity: { eid: `${session}:cancelled` },
      entry: { session },
      [STOP_ENTRY]: {},
    }], { trusted: true })
    status = await currentStatus(g, session)
  }
  let older = status == 'settled' &&
    (await g.read(`.entry.session=${session}&.call&!results&.limit=1`)).length >
      0
  if (ENDED.includes(status) && !older) {
    await ended(g, session, r)
    return newest(g, session)
  }
  if (!await admitted(g, session, r)) return newest(g, session)
  while (!r.stopping?.aborted) {
    // A renewal timer notices a lost lease eventually; this read closes the
    // gap between one completed step and the next.
    let owner = await lease(g, `${RUN}/${session}`)
    if (owner && owner.holder != r.holder) break
    let s = await step(g, session, r)
    r.each?.(s)
    if (s.did != 'nothing') await r.attempt?.progressed()
    if (ENDED.includes(s.status)) {
      await ended(g, session, r)
      break
    }
    if (s.did == 'nothing') {
      return { ...await newest(g, session), waiting: s.waiting }
    }
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
): Promise<Seen | null> => {
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

// Whether an entry or hosted receipt changed since the pass last checked it.
let owed = async (g: Graph, session: Eid, seen: Seen) => {
  let changed = (await newest(g, session)).seq > seen.seq
  if (!changed && seen.waiting) {
    let [ask] = await g.get([seen.waiting.call], ['inference', 'attempt'])
    let receipt = comp(ask, 'inference')?.receipt
    changed = comp(ask, 'attempt')?.by != null && !!receipt &&
      receipt != seen.waiting.receipt
  }
  if (!changed) return false
  let status = await currentStatus(g, session)
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
      // The lease is released by held before owing another pass. A ready
      // replacement may have already swept while we were still draining.
      if (r.stopping?.aborted && g.vocab.comp('effect')) {
        let status = await currentStatus(g, session)
        if (['pending', 'running', 'queued'].includes(status)) {
          await g.apply([{
            entity: { eid: crypto.randomUUID() },
            effect: {
              handler: 'session_run',
              target: session,
              kind: 'matched',
              state: 'pending',
              attempts: 0,
              generation: 0,
              at: new Date().toISOString(),
            },
          }], { trusted: true })
        }
      }
      await r.idle?.(session)
    }
  })()
  return p.done
}

/** Whether a transcript is being run by this process right now. */
export let runningHere = (g: Graph, session: Eid): boolean =>
  going(g).has(session)

/** Whether a native pass still owns work, here or in another process. */
export let runningAt = async (g: Graph, session: Eid): Promise<boolean> => {
  if (runningHere(g, session)) return true
  let held = await lease(g, `${RUN}/${session}`)
  return !!held?.holder && Date.parse(String(held.until)) > Date.now()
}

/** The pass this process is running over a transcript, to wait on, if any. */
export let passing = (g: Graph, session: Eid): Promise<void> | undefined =>
  going(g).get(session)?.done

// The transcripts an event owes a run: the one an entry is in (not a turn the
// runner itself took, which the run that wrote it carries on from), a
// transcript itself (admitted, or swept up), or those holding a task that
// completed or was cancelled, or holding one that contains or requires it. A
// dependency edge that went away is read as the commit found it.
let about = async (g: Graph, e: Event): Promise<Eid[]> => {
  let b = await one(g, e.entity.eid, ['entry', 'ask', 'task', 'edge'])
  if (b?.entry) {
    if (b.ask && !(e.name == 'inference' && e.comp?.receipt)) return []
    return [String(comp(b, 'entry')?.session)]
  }
  if (b && await isSession(g, b.entity.eid)) return [b.entity.eid]
  if (!holds(g)) return []
  let tasks = new Set<Eid>()
  if (b?.task) tasks.add(b.entity.eid)
  let edge = comp(b, 'edge') ?? comp(e.before, 'edge')
  for (let end of [edge?.from, edge?.to]) if (end) tasks.add(String(end))
  for (let t of [...tasks]) {
    for (let from of await dependents(g, t)) tasks.add(from)
  }
  let rows = await g.get([...tasks], [CLAIM])
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
  let asked = await g.read(`.entry.session=${session}&.using&?ask&?entry`)
  if (!asked.length) {
    let [self] = await g.read(
      `.entity.eid=${session}&.session&.fields=entity.eid` +
        (g.vocab.comp('fork') ? ',fork.from' : ''),
    )
    // An imported transcript can have thousands of asks and no provider
    // selection. Only a fork can inherit that selection from another session.
    if (self && !self.fork) {
      let asks = await g.read(
        `.entry.session=${session}&.ask&.fields=entity.eid&.limit=1`,
      )
      return asks.length > 0 &&
        (r.answers ? await r.answers(undefined, session) : true)
    }
  }
  let entries = asked.length ? asked : await statusEntries(g, session)
  if (!entries.some((b) => b.using || b.ask)) return false
  return r.answers ? await r.answers(usingBefore(entries), session) : true
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
    looking(g).get(session)?.()
    return void settle(g, session, r).catch(() => {})
  }
  if (await answering(g, session, r)) await settle(g, session, r)
}

// A terminal entry, a held task finishing, or a claim found by a worker's
// sweep identifies the transcript whose locks may be due for release. A
// managed run that ended cleanly keeps the ones it is parked on (./wake.ts):
// its next run is owed, or waits on a dependency. The guard protects a claim
// that another writer handed to a different session after this read.
let release = async (g: Graph, e: Event): Promise<void> => {
  let b = await one(g, e.entity.eid, ['entry', CLAIM])
  let session = b && await isSession(g, b.entity.eid)
    ? b.entity.eid
    : comp(b, 'entry')?.session ?? comp(b, CLAIM)?.session
  if (typeof session != 'string') return
  let row = await one(g, session, ['process', 'exit', STOP_ENTRY])
  if (row?.process && !row.exit) return
  let status = await currentStatus(g, session)
  if (status != 'stopped' && status != 'failed') return
  let owed = cleanEnd(row) && await requested(g, session)
  for (
    let held of await g.read(
      `.${CLAIM}.session=${session}&.fields=entity.eid`,
    )
  ) {
    if (owed || cleanEnd(row) && await waits(g, session, held.entity.eid)) {
      continue
    }
    try {
      await g.apply([{
        entity: held.entity,
        [CLAIM]: null,
        $was: { [CLAIM]: { session: token(session) } },
      }], { trusted: true })
    } catch (err) {
      if (!(err instanceof Stale)) throw err
    }
  }
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
  session_run: async (e, _tx, _write, attempt) => {
    // Every transcript the event names is answered; a failure in one, a
    // request to ask again among them, is thrown once the others are.
    let thrown: unknown
    for (let session of await about(g, e)) {
      await answer(g, session, { ...r, attempt }).catch((err) => {
        thrown ??= err
      })
    }
    if (thrown) throw thrown
  },
  ...declared(g, 'session_release')
    ? { session_release: (e: Event) => release(g, e) }
    : {},
  ...declared(g, 'session_wake')
    ? { session_wake: (e: Event) => woken(g, e) }
    : {},
})

// A task finished, or a dependency link went away: read as the commit found
// it, since a deleted edge no longer says which ends it had.
let woken = async (g: Graph, e: Event): Promise<void> => {
  if (e.kind != 'removed') return await wake(g, e.entity.eid)
  let edge = comp(e.before, 'edge') ??
    comp(await one(g, e.entity.eid, ['edge']), 'edge')
  if (edge) await unlinked(g, String(edge.from), String(edge.to))
}

let declared = (g: Graph, name: string) =>
  effectsIn(g.vocab.docs).some((e) => e.name == name)
