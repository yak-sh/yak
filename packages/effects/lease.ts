// A duty, and the one process running it.
//
// Some work is not about a batch at all: picking back up the agents a restart
// left running, freeing the locks a dead session held, firing the wakes that
// came due while nobody was looking. Every process that opens the graph could
// do it, and if they all did, an agent would be tailed twice and a wake fired
// twice. So each such duty is a row, and taking it is a contest:
//
//   lease{name, holder, until}
//
// The eid is derived from the name, the way an edge's eid is derived from its
// endpoints and relation, so one duty is one row in every graph and two
// processes reaching for it address the same row. Taking it is a write with a
// `$was` precondition — the holder and the expiry as the taker read them — so
// the loser is refused inside the transaction rather than overwriting the
// winner a moment later. Nothing here polls a lock table; the graph's own
// precondition is the lock.
//
// `until` is what makes a lease a lease. A holder that is still doing the work
// takes it again on a timer and pushes the expiry out; one that was killed
// leaves a row that expires, and the next process to ask gets it. Nothing has
// to clean up after it, which is the whole reason the duty is held under a
// lease rather than a claim. An asker that can tell the holder is gone (`gone`:
// its pid no longer running, or its row saying it is over) does not wait for
// the expiry at all.
//
// A graph whose vocabulary does not declare `lease` has no other process to
// contend with — one process, one graph — so every take succeeds and nothing
// is written.

import { after } from '@yaks/fp'
import type { Access, Bundle, Comp, Eid } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import { and, eq, every, or } from '@yaks/query'
import { finishedRun } from './cleanup.ts'

/** The name of the component a lease is stored as. */
export let LEASE = 'lease'

/** How long a take stands before another process may have it (ms). */
export let HOLD = 30_000

/** A lease row, as it is held. */
export type Lease = {
  /** the duty being held — the eid is derived from it */
  name?: string | null
  /** the process holding it */
  holder?: Eid | null
  /** when it expires, ISO-8601 */
  until?: string | null
}

/**
 * The eid a lease is stored at: `sha256("lease|<name>")` formatted as a uuid,
 * the same derivation an edge's eid gets.
 *
 * ```ts
 * leaseEid('@yaks/wake') == leaseEid('@yaks/wake') // true
 * ```
 */
export let leaseEid = (name: string): Eid => derivedEid(`${LEASE}|${name}`)

/** The arguments to a take: who is asking, and for how long. */
export type HoldOpts = {
  /** the process asking — what `holder` names */
  holder: Eid
  /** how long the take stands (default {@link HOLD}) */
  hold?: number
  /** the clock, in milliseconds (default `Date.now`) */
  now?: () => number
  /** whether a holder is known to be over (@yaks/process `gone`): its take no
   * longer stands, so the lease is had now rather than at its expiry (default:
   * nobody is known to be) */
  gone?: (holder: Eid) => boolean | Promise<boolean>
}

let leaseOf = (g: Access, eid: Eid): Promise<Lease | undefined> =>
  Promise.resolve(g.get([eid]))
    .then(([row]) => row?.[LEASE] as Lease | undefined)

/** Whether this graph contends at all: a component its vocabulary does not
 * declare cannot be stored on anything in it, so there is one process and the
 * duty is its own. */
let contested = (g: Access): boolean => !!g.vocab.comp(LEASE)

/**
 * Take a lease, or find out somebody else holds it. Returns whether it is now
 * ours — a holder taking its own again is a renewal, and pushes `until` out.
 *
 * ```ts
 * import { take } from '@yaks/effects'
 *
 * // if (await take(graph, '@yaks/wake', { holder: me })) …
 * ```
 */
export let take = async (
  g: Access,
  name: string,
  o: HoldOpts,
): Promise<boolean> => {
  if (!contested(g)) return true
  let [taken] = await taking(g, [name], o)
  if (!taken) return false
  try {
    await g.apply([taken])
    return true
  } catch (error) {
    // Another process got there first, inside the transaction. That is the
    // answer, not a failure.
    if (error instanceof Stale) return false
    throw error
  }
}

// The write that takes each of `names`, or `undefined` for one somebody else
// holds, read in one look.
let taking = async (
  g: Access,
  names: string[],
  o: HoldOpts,
): Promise<(Bundle | undefined)[]> => {
  let eids = names.map(leaseEid)
  let rows = new Map(
    (await g.get(eids)).map((row) => [row.entity.eid, row[LEASE] as Lease]),
  )
  let now = (o.now ?? Date.now)()
  return Promise.all(names.map(async (name, i) => {
    let eid = eids[i]
    let held = rows.get(eid)
    let until = held?.until ? Date.parse(String(held.until)) : 0
    // Somebody else's, and their take still stands: they are not known gone.
    if (
      held?.holder && held.holder != o.holder && until > now &&
      !await o.gone?.(held.holder)
    ) return undefined
    return {
      entity: { eid },
      [LEASE]: {
        name,
        holder: o.holder,
        until: new Date(now + (o.hold ?? HOLD)).toISOString(),
      },
      // Both properties, because both move: a rival taking an expired lease
      // moves `holder`, and the holder renewing it moves only `until`. Guarding
      // one would let the other slip past.
      $was: {
        [LEASE]: {
          holder: token(held?.holder ?? null),
          until: token(held?.until ?? null),
        },
      },
    } as Bundle
  }))
}

/**
 * Release a lease, if we are the one holding it. The row stays — the duty
 * outlives whoever was doing it — and the next process to ask gets it without
 * waiting for the expiry.
 */
export let drop = async (
  g: Access,
  name: string,
  o: { holder: Eid },
): Promise<void> => {
  if (!contested(g)) return
  let eid = leaseEid(name)
  let held = await leaseOf(g, eid)
  if (!held?.holder || held.holder != o.holder) return
  try {
    await g.apply([{
      entity: { eid },
      [LEASE]: { holder: null, until: null },
      $was: { [LEASE]: { holder: token(held.holder) } },
    } as Bundle])
  } catch (error) {
    // Somebody took it over while we were finishing. Releasing a lease we no
    // longer hold is a no-op, not an error.
    if (!(error instanceof Stale)) throw error
  }
}

let relinquish = (b: Bundle, comp: string, props: string[]): Bundle => ({
  entity: { eid: b.entity.eid },
  [comp]: Object.fromEntries(props.map((p) => [p, null])),
  $was: {
    [comp]: Object.fromEntries(
      props.map((p) => [p, token((b[comp] as Comp)?.[p] ?? null)]),
    ),
  },
})

let started = (b: Bundle, holder: Eid) => {
  let e = b.effect as Comp
  return e.kind == 'started' && e.target == holder && e.state == 'pending'
}

/**
 * Every duty and effect lease a holder has, as bundles that release them,
 * guarded against a concurrent handover — to be applied
 * in the same batch that records the holder's ending, because they are one
 * fact: a process that is over is not doing anything, and the next one to ask
 * should not have to wait out an expiry nobody is using. Its pending startup
 * runs end with it: another process owes its own startup, not this closure.
 */
export let released = (
  g: Access,
  holder: Eid,
): Bundle[] | Promise<Bundle[]> =>
  after(
    contested(g) ? g.read(`.${LEASE}.holder=${holder}`) : [],
    (leases) =>
      after(
        g.vocab.comp('effect')
          ? g.read(and(
            or(
              eq('effect.lease_owner', holder),
              and(
                eq('effect.kind', 'started'),
                eq('effect.target', holder),
                eq('effect.state', 'pending'),
              ),
            ),
            every(),
          ))
          : [],
        (runs) => [
          ...leases.map((b) => relinquish(b, LEASE, ['holder', 'until'])),
          ...runs.flatMap((b) =>
            started(b, holder) ? finishedRun(b) : [relinquish(b, 'effect', [
              'lease_owner',
              'lease_token',
              'lease_expiry',
            ])]
          ),
        ],
      ),
  )

/** Who holds a lease right now, if anybody — the read a check makes. */
export let held = (g: Access, name: string): Promise<Lease | undefined> =>
  contested(g) ? leaseOf(g, leaseEid(name)) : Promise.resolve(undefined)

/** Wait, unless we are done waiting: a sleep the signal cuts short, so a pass
 * between renewals releases the lease the moment it is asked to. */
export { sleep } from '@yaks/fp'
import { sleep } from '@yaks/fp'

/** How a lease is held for a while: {@link HoldOpts}, plus what signals that
 * we are done, how often to retry while somebody else holds it, and where a
 * store that failed to answer is told. */
export type HoldingOpts = HoldOpts & {
  /** abort to release the lease. Already aborted means one pass and out — a
   * CLI command does what nobody else is doing and never queues for what
   * somebody else is. */
  signal?: AbortSignal
  /** whether to wait out a holder ahead of this one (default: while the
   * signal is live). Not waiting answers at once, leaving the work to them —
   * one run of something whose holder already runs it, like a transcript's
   * turn — and a take the store fails is then thrown, for the caller to try
   * again, rather than waited out. */
  wait?: boolean
  /** how often to ask again while somebody else holds it (default a tenth of
   * the hold) */
  poll?: number
  /** a take or a renewal the store failed (default `console.error`); it is
   * asked again, since a busy store is not an answer */
  report?: (err: unknown) => void
}

// A lease held while its work runs: what renews it, what aborts when another
// process has it, and where a store that failed to answer is told.
type Renewal = {
  name: string
  ask: HoldOpts & { hold: number }
  lost: AbortController
  report: (err: unknown) => void
}
type Beat = {
  renewals: Set<Renewal>
  beating: boolean
  timer?: ReturnType<typeof setInterval>
}

// The leases one holder holds in one graph for one length of hold, renewed on
// one timer in one commit: a process holding fifteen duties writes once a beat,
// not fifteen times.
let beats = new WeakMap<Access, Map<string, Beat>>()

// Renew `r` beside the others its holder holds, until the answer is called.
// Renewed on a timer while the work runs: a holder still at it never expires,
// and one that stops existing does. One renewal at a time, so two of this
// process's own cannot refuse each other.
let beside = (g: Access, r: Renewal): () => void => {
  let held = beats.get(g) ?? new Map<string, Beat>()
  beats.set(g, held)
  let key = `${r.ask.holder}|${r.ask.hold}`
  let beat = held.get(key)
  if (!beat) {
    let b: Beat = beat = { renewals: new Set(), beating: false }
    held.set(key, b)
    // A third of the hold, however short: a renewal later than the hold would
    // let the lease lapse under work still running.
    b.timer = setInterval(async () => {
      if (b.beating) return
      b.beating = true
      try {
        await renew(g, [...b.renewals], (r) => b.renewals.has(r))
      } finally {
        b.beating = false
      }
    }, Math.max(1, Math.floor(r.ask.hold / 3)))
  }
  let b = beat
  b.renewals.add(r)
  return () => {
    b.renewals.delete(r)
    if (b.renewals.size) return
    clearInterval(b.timer)
    held.delete(key)
  }
}

// One commit renewing every lease a beat holds. One somebody else holds now is
// lost; a commit refused is asked again a lease at a time, and a refusal is
// read back before it counts, since only another holder means it is gone.
//
// A beat runs beside the work, so the work can end while one is under way.
// `kept` says whether a renewal is still wanted: a lease its holder has let go
// is not taken back, and nothing the store fails about it is anybody's to hear,
// since a holder on its way out may have closed the store behind it.
let renew = async (
  g: Access,
  all: Renewal[],
  kept: (r: Renewal) => boolean,
): Promise<void> => {
  if (!all.length) return
  let { ask } = all[0]
  try {
    let bundles = await taking(g, all.map((r) => r.name), ask)
    all.forEach((r, i) => bundles[i] || r.lost.abort())
    let taken = bundles.filter((b, i): b is Bundle => !!b && kept(all[i]))
    if (!taken.length) return
    try {
      await g.apply(taken)
      return
    } catch (error) {
      if (!(error instanceof Stale)) throw error
    }
  } catch (e) {
    return all.find(kept)?.report(e)
  }
  for (let r of all) {
    if (r.lost.signal.aborted || !kept(r)) continue
    try {
      if (await take(g, r.name, r.ask)) continue
      if ((await held(g, r.name))?.holder != r.ask.holder) r.lost.abort()
    } catch (e) {
      if (kept(r)) r.report(e)
    }
  }
}

/**
 * Run a duty for as long as this process is up: take the lease, renew it
 * while the work runs, and release it at the end. Answers what the work last
 * answered, or `undefined` where it never ran.
 *
 * The same call serves a process of either shape, which is the point — nothing
 * here assumes a separate one. A server or a TUI passes a live signal and
 * holds the lease until that aborts, waiting for the holder ahead of it to
 * expire; a one-shot CLI command passes a signal that has already aborted,
 * does the pass if nobody else is, and releases on the way out. Either way the
 * lease is renewed for as long as the work runs.
 *
 * The work is handed a signal that also aborts when the lease is lost: a
 * renewal that finds another process holding it means that process is doing
 * the duty now, so this one stops, and goes back to waiting in case that one
 * stops too. Renewals run on a timer beside the work, so the work has to
 * yield to timers (a sleep, a wait on I/O) more often than a third of the
 * hold; a step that blocks longer can lapse, and the next renewal to run
 * finds out and stops it.
 *
 * ```ts
 * import { holding } from '@yaks/effects'
 *
 * // await holding(graph, '@yaks/wake', { holder: me, signal }, (s) => loop(g, { signal: s }))
 * ```
 */
export let holding = async <T = void>(
  g: Access,
  name: string,
  o: HoldingOpts,
  work: (signal: AbortSignal) => T | Promise<T>,
): Promise<T | undefined> => {
  let signal = o.signal ?? AbortSignal.abort()
  let wait = o.wait ?? !signal.aborted
  let hold = o.hold ?? HOLD
  let ask = { ...o, hold }
  let report = o.report ?? ((e: unknown) => console.error(`${name} —`, e))
  // A take the store failed is not a no. Waiting, it is told and asked again
  // next time; not waiting, there is no next time here, so the caller hears.
  let ours = () =>
    wait
      ? take(g, name, ask).catch((e) => {
        report(e)
        return false
      })
      : take(g, name, ask)
  let out: T | undefined
  while (true) {
    while (!await ours()) {
      // Somebody is doing it. A process that is staying up waits them out — a
      // holder that was killed expires and this is what takes over — and one
      // that is only passing through leaves it to them.
      if (!wait || signal.aborted) return out
      await sleep(o.poll ?? Math.max(250, Math.floor(hold / 10)), signal)
      if (signal.aborted) return out
    }
    let lost = new AbortController()
    let leave = beside(g, { name, ask, lost, report })
    try {
      out = await work(AbortSignal.any([signal, lost.signal]))
    } finally {
      leave()
      await drop(g, name, { holder: o.holder }).catch(report)
    }
    if (signal.aborted || !lost.signal.aborted) return out
  }
}

/** A promise that keeps a lease held and does nothing else, until the signal
 * reports that we are done — what a pass that has already finished its work
 * waits on, so the lease stays this process's while it is up. */
export let until = (signal: AbortSignal): Promise<void> =>
  signal.aborted
    ? Promise.resolve()
    : new Promise((done) =>
      signal.addEventListener('abort', () => done(), {
        once: true,
      })
    )
