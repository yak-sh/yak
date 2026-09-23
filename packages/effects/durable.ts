// The durability tier, and it is optional. An effect in memory is at-most-once
// by construction: the transaction committed, the process died, the handler
// never ran, and nothing anywhere records that it was supposed to. For most
// effects that is the right trade — a re-render, a cache eviction, a log line.
// For the ones that reach an external system (a receipt, a mail, a spawned
// process) a lost run is a lost thing, so this file writes the run down.
//
// It is a component and a wrapper, nothing more:
//
//   effect{handler, target, comp, kind, state, attempts, error, next, lease_*}
//
// One row per handler run, written before the handler runs and marked after.
// A run that did not complete is tried again — `tries` attempts in all, each
// one waiting out a backoff — and after the last it is left `failed` with the
// error it last threw beside it, for a person to look at. That is the whole
// retry, and it is here rather than in any handler: nothing an effect could do
// about its own failure would be anything but this, repeated.
//
// There are two ways a run does not complete, and they are not the same thing:
//
//   It reported. The handler threw, so it got to report the failure, and
//   whatever it had done before that it undid or never started. The row is
//   marked with the error and `next` — the instant its backoff is up — and the
//   sweep runs it again then.
//
//   It was interrupted. The process died mid-run, or its lease expired while
//   it held it: nothing records how far it got. A row with no `next` is one of
//   these, and it is tried again too — unless its registration set
//   `idempotent: false`, in which case a second run could duplicate something
//   that already reached an external system, and it is left failed instead.
//
// How many attempts a run gets is the registration's to declare (`tries` in a
// Policy) and never one call's, so no effect anywhere carries retry code of
// its own.
//
// The lease is what keeps two processes off the same row: a reconciler claims
// a row for a while (owner, token, expiry) before running it, and skips a row
// whose claim belongs to somebody else and has not expired.
//
// A pattern effect is written down the same way, as `matched` on the entity
// its first pattern bound. What a retry reconstructs is that entity, not the
// bindings a join produced — enough for a handler that is about one entity,
// which is what a pattern registration almost always is.
//
// Loading the component is the application's choice — an app with no durable
// effects loads no `effect` component and stores nothing.
//
// The document itself is `./vocab.json` — plain JSON Schema, readable by
// anything that reads JSON. This file re-exports it under the name callers
// import and keeps the prose about why it is shaped the way it is.

import type { Comp, Eid, Tx } from '@yaks/graph'
import { each, isPromise, then } from '@yaks/graph'
import { and, eq } from '@yaks/query'
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import type { Around, Effects } from './registry.ts'
import type { Policy } from './registration.ts'
import type { Kind } from './trace.ts'

/**
 * This package's components, to load beside your own when you want durable
 * effects: `loadVocab([effectDoc, ...mine])`. Two components, one document —
 * `effect`, whose every property is server-owned because a client never writes
 * a run's bookkeeping, and `lease` (./lease.ts), which marks a duty as
 * held by one process at a time.
 */
export let effectDoc: VocabDoc = doc

/** The ledger's component, by the name ./vocab.json declares it. */
export let EFFECT = 'effect'

/** The most attempts a run gets where its registration does not declare one:
 * the first, and two more. */
export let TRIES = 3

/** How long after the nth attempt the next one falls due: a second, doubling,
 * and never more than five minutes apart. */
export let backoff = (attempts: number): number =>
  Math.min(300_000, 1000 * 2 ** (attempts - 1))

/** How a ledger is built. */
export type LedgerOpts = {
  /** who this process is, written into a row it claims */
  owner: string
  /** how long a claim holds, in milliseconds (default: 60_000) */
  lease?: number
  /** the most attempts a run gets where its registration declares none
   * (default: {@link TRIES}) */
  tries?: number
  /** how long after the nth attempt the next is due, in milliseconds
   * (default: {@link backoff}) */
  backoff?: (attempts: number) => number
  /** the clock, in milliseconds (default: `Date.now`) */
  now?: () => number
  /** ids for the rows it writes (default: `crypto.randomUUID()`) */
  mint?: () => Eid
}

/**
 * A ledger: the wrapper that records runs, and the pass that finishes what a
 * crash interrupted and what a failed run is still owed.
 */
export type Ledger = {
  /** hand this to `effects(vocab, { around })` and every run is written down */
  around: Around
  /** run what is outstanding — interrupted runs, and failures whose backoff
   * is up — one attempt each; returns how many it ran */
  reconcile: (fx: Effects, tx: Tx) => number | Promise<number>
  /** when the soonest waiting retry falls due, in milliseconds, or `undefined`
   * where none is waiting — what a sweep sleeps until, rather than polling */
  due: (tx: Tx) => number | undefined | Promise<number | undefined>
}

// What a handler threw, as the row can keep it.
let said = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

/**
 * A durable ledger over the `effect` component:
 *
 * ```ts
 * import { detached, graph } from '@yaks/graph'
 * import { effects, effectDoc, ledger } from '@yaks/effects'
 *
 * let log = ledger({ owner: 'worker-1' })
 * let fx = effects(vocab, { around: log.around })
 * // at boot, and on a beat after that:
 * // log.reconcile(fx, detached(storage))
 * ```
 *
 * The vocabulary must carry {@link effectDoc}, and the handlers must be
 * registered before `reconcile()` runs — a row names its handler by slot id,
 * and an id nobody claims is reported, not guessed at.
 */
export let ledger = (opts: LedgerOpts): Ledger => {
  let clock = opts.now ?? (() => Date.now())
  let hold = opts.lease ?? 60_000
  let mint = opts.mint ?? (() => crypto.randomUUID() as Eid)
  let stamp = (ms: number) => new Date(ms).toISOString()
  let wait = opts.backoff ?? backoff
  // What a registration declared about being retried, and about being run
  // twice. The slot is the only place either is ever read from.
  let limit = (slot?: Policy) => slot?.tries ?? opts.tries ?? TRIES
  let safe = (slot?: Policy) => slot?.idempotent != false

  let write = (tx: Tx, eid: Eid, effect: Comp) =>
    tx.patch([{ entity: { eid }, [EFFECT]: effect }])

  // A released claim. Every ending writes it, because a row nobody is running
  // must not look like a row somebody is.
  let free = { lease_owner: null, lease_token: null, lease_expiry: null }

  let landed = (tx: Tx, eid: Eid) =>
    write(tx, eid, { state: 'done', error: null, next: null, ...free })

  /** It is over, and it did not complete: the outcome a person reads, with
   * the last error beside it. */
  let rest = (tx: Tx, eid: Eid, error: string | null) =>
    write(tx, eid, { state: 'failed', error, next: null, ...free })

  // A run that did not complete, in one rule — the same one for a handler
  // that threw inline and for a retry that threw again, which is why neither
  // writes an outcome of its own. Another attempt if its registration allows
  // one, due once its backoff is up; left failed otherwise.
  let fell = (
    tx: Tx,
    eid: Eid,
    attempts: number,
    slot: Policy | undefined,
    err: unknown,
  ) =>
    attempts < limit(slot)
      ? write(tx, eid, {
        state: 'pending',
        error: said(err),
        next: stamp(clock() + wait(attempts)),
        ...free,
      })
      : rest(tx, eid, said(err))

  // The row a retry is for, handed to the wrapper below. `reconcile` claimed
  // it and wrote the attempt down already, so the wrapper reuses that row
  // instead of minting a second one for the same run. The handoff is
  // synchronous — `fx.attempt` calls `fire`, and `fire` calls `around`, before
  // anything awaits — so nothing else can run between them.
  let resuming: { eid: Eid; attempts: number } | undefined

  let around: Around = (job, tx, next) => {
    let held = resuming
    resuming = undefined
    let eid = held?.eid ?? mint()
    let attempts = held?.attempts ?? 1
    let go = () => {
      // The handler's own failure still belongs to the caller — the registry
      // isolates it — so the row is marked and the throw goes on.
      let raise = (err: unknown) =>
        then(fell(tx, eid, attempts, job.slot, err), (): never => {
          throw err
        })
      try {
        let out = next()
        return isPromise(out)
          ? out.then((v) => then(landed(tx, eid), () => v), raise)
          : then(landed(tx, eid), () => out)
      } catch (err) {
        return raise(err)
      }
    }
    return held ? go() : then(
      write(tx, eid, {
        handler: job.handler,
        target: job.event.entity.eid,
        comp: job.event.name,
        kind: job.event.kind,
        state: 'pending',
        attempts,
        at: stamp(clock()),
      }),
      go,
    )
  }

  // One row that is owed a run: claim it, rebuild the event it was recorded
  // for, and run the handler through the registry's own `attempt` method. The
  // outcome is `around`'s to write, above — this writes none.
  let run = (
    fx: Effects,
    tx: Tx,
    eid: Eid,
    row: Comp,
  ): boolean | Promise<boolean> => {
    let handler = String(row.handler)
    let slot = fx.slots().find((s) => s.id == handler)
    // A complementary process must not claim (or mark failed) work belonging
    // to its sibling. Unknown ids still take the ordinary reporting path.
    if (slot && !fx.owns(handler)) return false
    let attempts = Number(row.attempts ?? 0)
    let now = clock()
    let expiry = row.lease_expiry ? Date.parse(String(row.lease_expiry)) : 0
    // Somebody else is on it, and their claim still stands.
    if (expiry > now && row.lease_owner != opts.owner) return false
    // A failure that reported is waiting out its backoff.
    let due = row.next ? Date.parse(String(row.next)) : 0
    if (due > now) return false
    // Every attempt spent: it is left failed, with the last error beside it.
    if (attempts >= limit(slot)) {
      return then(
        rest(tx, eid, row.error == null ? null : String(row.error)),
        () => false,
      )
    }
    // No `next` and it is here: the run was interrupted rather than reported,
    // so how far it got is unknown. A handler that declared running it twice
    // is not the same as running it once does not get a second attempt.
    if (!row.next && !safe(slot)) {
      return then(
        rest(tx, eid, `interrupted, and ${handler} is not idempotent`),
        () => false,
      )
    }
    let name = String(row.comp)
    return then(
      write(tx, eid, {
        attempts: attempts + 1,
        // It is running now, not waiting — and that is what tells the next
        // reconciler an interrupted run apart from a reported failure.
        next: null,
        lease_owner: opts.owner,
        lease_token: mint(),
        lease_expiry: stamp(now + hold),
      }),
      () =>
        then(tx.get([String(row.target)]), ([found]) => {
          let kind = String(row.kind) as Kind
          resuming = { eid, attempts: attempts + 1 }
          return then(
            fx.attempt(handler, {
              kind,
              entity: found?.entity ?? { eid: String(row.target) },
              name,
              comp: kind == 'removed'
                ? undefined
                : found?.[name] as Comp | undefined,
            }, tx),
            () => {
              // The wrapper takes `resuming` on its way in, so one still
              // sitting here means the handler never got that far: a slot
              // nobody registered, which the registry has already reported.
              if (!resuming) return true
              resuming = undefined
              return then(
                rest(tx, eid, `no effect registered as ${handler}`),
                () => true,
              )
            },
          )
        }),
    )
  }

  let pending = (tx: Tx) => tx.read(and(eq(`${EFFECT}.state`, 'pending')))

  return {
    around,
    reconcile: (fx, tx) =>
      then(
        pending(tx),
        (rows) =>
          each(
            rows,
            0,
            (n, b) =>
              then(
                run(fx, tx, b.entity.eid, (b.effect ?? {}) as Comp),
                (ran) => n + (ran ? 1 : 0),
              ),
          ),
      ),
    due: (tx) =>
      then(pending(tx), (rows) => {
        let soonest: number | undefined
        for (let b of rows) {
          let next = (b.effect as Comp | undefined)?.next
          let at = next ? Date.parse(String(next)) : NaN
          if (!isNaN(at) && (soonest == null || at < soonest)) soonest = at
        }
        return soonest
      }),
  }
}
