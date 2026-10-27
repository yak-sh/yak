import { derivedEid } from '@yaks/graph/identity'
// Hosted transcripts advance through independently owed effects: session_run
// owns one model/context step and session_tool owns one call. Committed inputs,
// completed requests, context checkpoints and final tool results owe the next
// step. The session lease covers one step, and the tool runner claims each call.
// A standalone consumer without a durable pool can explicitly settle a turn.

import type { Event, Handlers } from '@yaks/effects'
import { enqueue, held as lease, HOLD, holding } from '@yaks/effects'
import type { Bundle, Comp, Eid, Graph, ReadTx } from '@yaks/graph'
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
import { currentStatus, type Deps, react, type Step } from './react.ts'
import { hasAsk, openOf, usingOf } from './reach.ts'
import { kindOf, seqOf, type TranscriptStatus } from './state.ts'
import { UnknownSession } from './unknown.ts'
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
  each?: (step: Step, session?: string) => void | Promise<void>
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
// queued recovery can run again, and telling is idempotent.
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
      'lines',
      'output',
      'call',
      'result',
    ])
    if (
      comp(input, 'entry')?.session != session || !input?.using ||
      !input.content || input.lines || input.output || input.call ||
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
          ['entry', 'content', 'using', 'lines', 'output', 'call', 'result']
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
      entity: { eid: derivedEid(`${session}:preparation-error`) },
      entry: { session },
      exception: exceptionOf(err),
      content: { body: String(err) },
    }, {
      entity: { eid: derivedEid(`${session}:preparation-stop`) },
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

// A cancelled task withdraws the work its transcript was doing.
let prepared = async (g: Graph, session: Eid) => {
  let status = await currentStatus(g, session)
  let held = holds(g)
    ? await g.read(`.task&.claim.session=${session}&.cancelled`)
    : []
  if (held.length && status != 'stopped') {
    await g.apply([{
      entity: { eid: derivedEid(`${session}:cancelled`) },
      entry: { session },
      [STOP_ENTRY]: {},
    }], { trusted: true })
    status = await currentStatus(g, session)
  }
  return status
}

// The steps a held transcript takes: until one does nothing, or it ends.
// Answers the newest seq it saw.
let turns = async (g: Graph, session: Eid, r: Runner): Promise<Seen> => {
  // A terminal transcript owes no model step. Use the already-derived fact
  // before loading all entry marks; old unresolved calls still keep settled
  // transcripts runnable and are queried explicitly when that matters.
  let status = await prepared(g, session)
  let older = status == 'settled' &&
    (await openOf(g, session)).some((b) => comp(b, 'entry')?.session == session)
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
    await r.each?.(s, String(session))
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
      // A replacement may have polled before the old worker drained.
      if (r.stopping?.aborted && g.vocab.comp('effect')) {
        let status = await currentStatus(g, session)
        if (['pending', 'running', 'queued'].includes(status)) {
          await enqueue(g, 'session_run', session)
        }
      }
      await r.idle?.(session)
    }
  })()
  return p.done
}

/** Whether a transcript is being run by this process right now. */
export let runningHere = (g: Graph, session: Eid): boolean =>
  going(g).has(session) || advancing(g).has(session)

/** Whether a native pass still owns work, here or in another process. */
export let runningAt = async (g: Graph, session: Eid): Promise<boolean> => {
  if (runningHere(g, session)) return true
  let held = await lease(g, `${RUN}/${session}`)
  return !!held?.holder && Date.parse(String(held.until)) > Date.now()
}

/** The pass this process is running over a transcript, to wait on, if any. */
export let passing = (g: Graph, session: Eid): Promise<void> | undefined =>
  going(g).get(session)?.done ?? advancing(g).get(session)?.done

// Each owed effect owns one step. Waiting effects retain their durable pool
// claim; a crash leaves it available to the next worker. Duplicate wakes join
// that obligation without holding pool slots, including while this worker
// waits on another worker's session lease. One durable followup preserves them,
// unless the step taken wrote every change that joined it and left its
// transcript owing no turn: a step's own reply wakes its transcript, and a
// followup would find only the step already taken. A pass a stop cut short
// owes one too while its transcript owes a turn or the telling of its end.
type Advance = { done: Promise<void>; joined: Eid[]; took?: Step; told?: true }
let steps = new WeakMap<Graph, Map<Eid, Advance>>()
let advancing = (g: Graph) => {
  let here = steps.get(g)
  if (!here) steps.set(g, here = new Map())
  return here
}

// Whether the step a pass took already answers every wake that joined it.
let covered = ({ joined, took }: Advance) =>
  !!took && took.status != 'pending' &&
  joined.every((eid) => took.added.some((b) => b.entity.eid == eid))

/** One step owed to a transcript by a change to `cause`. */
let advance = (
  g: Graph,
  session: Eid,
  r: Runner,
  cause: Eid,
): Promise<void> => {
  looking(g).get(session)?.()
  let here = advancing(g)
  let previous = here.get(session)
  if (previous) {
    previous.joined.push(cause)
    return Promise.resolve()
  }
  let pass: Advance = { done: Promise.resolve(), joined: [] }
  here.set(session, pass)
  let end = async () => {
    await ended(g, session, r)
    pass.told = true
  }
  let done = Promise.resolve().then(async () => {
    if (!await answering(g, session, r)) {
      let status = await prepared(g, session)
      if (ENDED.includes(status)) {
        await end()
        return
      }
      if (await usingOf(g, session) || await hasAsk(g, session)) {
        await r.attempt?.defer?.(1000)
      }
      return
    }
    await holding(g, `${RUN}/${session}`, {
      holder: r.holder,
      hold: r.hold ?? HOLD,
      gone: r.gone,
      signal: r.stopping ?? new AbortController().signal,
      wait: true,
      poll: 100,
      report: (error) => r.report?.(error, session, 'lease'),
    }, async (stopping) => {
      if (stopping.aborted) return
      let status = await prepared(g, session)
      if (ENDED.includes(status)) {
        await end()
        return
      }
      if (!await admitted(g, session, r)) return
      let s = pass.took = await step(g, session, { ...r, stopping })
      await r.each?.(s, session)
      if (ENDED.includes(s.status)) await end()
    })
  }).finally(async () => {
    if (here.get(session) == pass) here.delete(session)
    let cut = r.stopping?.aborted
    if ((pass.joined.length && !covered(pass)) || cut) {
      let status = await currentStatus(g, session)
      if (
        ['pending', 'running', 'queued'].includes(status) ||
        cut && ENDED.includes(status) && !pass.told
      ) {
        await enqueue(g, 'session_run', session)
      }
    }
    await r.idle?.(session)
  })
  pass.done = done
  return done
}

// Each committed input, result, completed request or context checkpoint owes
// its transcript a step. Admission names the transcript directly;
// a task or dependency change also wakes the transcripts holding that work.
// A removed dependency is read with the ends it had before the commit.
let about = async (g: Graph, e: Event): Promise<Eid[]> => {
  let b = e.name == 'content'
    ? (await g.get([e.entity.eid]))[0]
    : await one(g, e.entity.eid, [
      'entry',
      'ask',
      'task',
      'edge',
      'provisional',
      'attempt',
    ])
  if (b?.entry) {
    if (e.name == 'content' && (b.notice || kindOf(b) != 'input')) return []
    let session = String(comp(b, 'entry')?.session)
    if (e.name == 'content' && !await usingOf(g, session)) return []
    if (
      b.ask && !(
        e.name == 'inference' && e.comp?.receipt ||
        e.name == 'attempt' && comp(b, 'attempt')?.by == null && !b.provisional
      )
    ) return []
    return [session]
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
  let using = await usingOf(g, session)
  // An imported transcript can have thousands of asks and no provider
  // selection, so an ask is looked for alone.
  if (!using && !await hasAsk(g, session)) return false
  return r.answers ? await r.answers(using, session) : true
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
  if (g.vocab.comp('effect')) {
    looking(g).get(session)?.()
    await enqueue(g, 'session_run', session)
    return
  }
  if (runningHere(g, session)) {
    looking(g).get(session)?.()
    return void settle(g, session, r).catch(() => {})
  }
  if (await answering(g, session, r)) await settle(g, session, r)
}

// A terminal entry or a held task finishing identifies the transcript whose
// locks may be due for release. A
// managed run that ended cleanly keeps the ones it is parked on (./wake.ts):
// its next run is owed, or waits on a dependency. The guard protects a claim
// that another writer handed to a different session after this read. A swept
// claim can also name a holder the graph no longer has.
let release = async (g: Graph, e: Event, tx: ReadTx): Promise<void> => {
  let b = await one(g, e.entity.eid, ['entry', CLAIM])
  let session = b && await isSession(g, b.entity.eid)
    ? b.entity.eid
    : comp(b, 'entry')?.session ?? comp(b, CLAIM)?.session
  if (typeof session != 'string') return
  let present = async () =>
    (await tx.read(
      `.entity.eid=${session}&.session&.fields=entity.eid`,
    )).length > 0
  let live = await present()
  // A hidden holder is not a missing holder. Effects receive an authoritative
  // reader, while the graph still controls which claims this run can touch.
  if (live && !await isSession(g, session)) return
  let row = await one(g, session, ['process', 'exit', STOP_ENTRY])
  if (live && row?.process && !row.exit) return
  if (live) {
    let status: TranscriptStatus | undefined
    try {
      status = await currentStatus(g, session)
    } catch (error) {
      if (!(error instanceof UnknownSession) || error.session != session) {
        throw error
      }
      if (await present()) return
      live = false
    }
    if (live && status != 'stopped' && status != 'failed') return
  }
  let parked = live && cleanEnd(row)
  let owed = parked && await requested(g, session)
  for (
    let held of await g.read(
      `.${CLAIM}.session=${session}&.fields=entity.eid`,
    )
  ) {
    if (owed || parked && await waits(g, session, held.entity.eid)) {
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
 * transcript write owes one leased step, where this host answers its provider.
 * Without a durable pool, a standalone consumer uses {@link settle}.
 *
 * ```ts
 * import { answers, running } from '@yaks/session'
 *
 * // export let effects = (host) => running(host.graph, { holder: host.me, … })
 * ```
 */
export let running = (g: Graph, runner: Runner): Handlers => {
  let pooled = !!g.vocab.comp('effect')
  let r = { ...runner, asyncTools: pooled && !!g.vocab.comp('tool_async') }
  let run: Handlers[string] = async (e, _tx, _write, attempt) => {
    // Every transcript the event names is answered; a failure in one, a
    // request to ask again among them, is thrown once the others are.
    let thrown: unknown
    for (let session of await about(g, e)) {
      await (pooled
        ? advance(g, session, { ...r, attempt }, e.entity.eid)
        : answer(g, session, { ...r, attempt })).catch((err) => {
          thrown ??= err
        })
    }
    if (thrown) throw thrown
  }
  return {
    ...declared(g, 'session_input') ? { session_input: run } : {},
    ...declared(g, 'session_tool')
      ? {
        session_tool: async (e: Event, _tx, _write, attempt) => {
          let [call] = await g.get([e.entity.eid])
          let session = (call?.entry as Comp | undefined)?.session
          if (!call?.tool_async || !session || !r.asyncTools) return
          if (
            ['stopped', 'failed'].includes(await prepared(g, String(session)))
          ) return
          if (
            (await g.read(
              `.result.call=${call.entity.eid} .limit=1 .fields=entity.eid`,
            )).length
          ) return
          const source = (call.call as Comp | undefined)?.source
          const [asked] = source ? await g.get([String(source)], ['using']) : []
          if (
            r.answers && !await r.answers(asked?.using as Comp | undefined)
          ) {
            await attempt?.defer?.(1000)
            return
          }
          // The tool runner's claim, not the session's lease, serializes this call.
          // A restarted effect inspects uncertain execution instead of replaying it.
          let s = await react(g, String(session), {
            ...r,
            owner: r.holder,
            asyncTools: false,
            runCall: call.entity.eid,
          })
          await r.each?.(s, String(session))
        },
      }
      : {},
    session_run: run,
    ...declared(g, 'session_release')
      ? { session_release: (e: Event, tx: ReadTx) => release(g, e, tx) }
      : {},
    ...declared(g, 'session_wake')
      ? { session_wake: (e: Event) => woken(g, e) }
      : {},
  }
}

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
