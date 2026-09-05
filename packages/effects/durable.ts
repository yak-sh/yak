// The durability tier, and it is OPTIONAL. An effect in memory is at-most-once
// by construction: the transaction committed, the process died, the handler
// never ran, and nothing anywhere remembers that it was supposed to. For most
// effects that is the right trade — a re-render, a cache eviction, a log line.
// For the ones that reach the world (a receipt, a mail, a spawned process) a
// lost run is a lost thing, so this file writes the run down.
//
// It is a component and a wrapper, nothing more:
//
//   effect{handler, target, comp, kind, state, attempts, lease_*}
//
// One row per handler run, written BEFORE the handler runs and marked after.
// A row still `pending` when a process starts is a run that was interrupted,
// and `reconcile()` gives it ONE more attempt — at most once, deliberately: a
// handler that ran, wrote its receipt, and died before its row was marked must
// not send a second receipt, so a row that has spent its retry is marked
// failed and left for a human rather than looped over.
//
// The lease is what keeps two processes off the same row: a reconciler claims
// a row for a while (owner, token, expiry) before running it, and skips a row
// whose claim is somebody else's and has not expired.
//
// Loading the component is the application's choice — an app with no durable
// effects loads no `effect` component and stores nothing.

import type { Comp, Eid, Tx } from '@yaks/graph'
import { each, isPromise, then } from '@yaks/graph'
import { and, eq } from '@yaks/query'
import { CORE_URI, type VocabDoc } from '@yaks/vocab'
import type { Around, Effects } from './registry.ts'
import type { Kind } from './trace.ts'

/**
 * The `effect` component as a vocabulary document, to load beside your own
 * when you want durable effects: `loadVocab([effectDoc, ...mine])`. Every
 * column is server-owned — a client never writes a run's bookkeeping.
 */
export let effectDoc: VocabDoc = {
  $vocabulary: { [CORE_URI]: true },
  title: 'effect',
  $defs: {
    effect: {
      type: 'object',
      properties: {
        handler: {
          type: 'string',
          stamped: true,
          description: 'the registration that ran, by its slot id',
        },
        target: {
          type: 'string',
          ref: 'entity',
          death: 'keep',
          stamped: true,
          description: 'the entity the committed change was about',
        },
        comp: {
          type: 'string',
          stamped: true,
          description: 'the component that changed',
        },
        kind: {
          enum: ['created', 'changed', 'removed'],
          stamped: true,
          description: 'what happened to it',
        },
        state: {
          enum: ['pending', 'done', 'failed'],
          stamped: true,
          description: 'where the run got to',
        },
        attempts: {
          type: 'number',
          stamped: true,
          description: 'how many times the handler has been started',
        },
        at: {
          type: 'string',
          format: 'date-time',
          stamped: true,
          description: 'when the run was recorded',
        },
        lease_owner: {
          type: 'string',
          stamped: true,
          description: 'the process currently reconciling this row',
        },
        lease_token: {
          type: 'string',
          stamped: true,
          description: "that claim's token, fresh on every claim",
        },
        lease_expiry: {
          type: 'string',
          format: 'date-time',
          stamped: true,
          description: 'when the claim lapses and another process may take it',
        },
      },
    },
  },
}

/** How a ledger is built. */
export type LedgerOpts = {
  /** who this process is, written into a row it claims */
  owner: string
  /** how long a claim holds, in milliseconds (default: 60_000) */
  lease?: number
  /** the clock, in milliseconds (default: `Date.now`) */
  now?: () => number
  /** ids for the rows it writes (default: `crypto.randomUUID()`) */
  mint?: () => Eid
}

/**
 * A ledger: the wrapper that records runs, and the boot pass that finishes
 * what a crash interrupted.
 */
export type Ledger = {
  /** hand this to `effects(vocab, { around })` and every run is written down */
  around: Around
  /** re-run what was left `pending`, one attempt each → how many it ran */
  reconcile: (fx: Effects, tx: Tx) => number | Promise<number>
}

// The most attempts a run ever gets: the original, and one retry.
let LIMIT = 2

/**
 * A durable ledger over the `effect` component:
 *
 * ```ts
 * import { detached, graph } from '@yaks/graph'
 * import { effects, effectDoc, ledger } from '@yaks/effects'
 *
 * let log = ledger({ owner: 'worker-1' })
 * let fx = effects(vocab, { around: log.around })
 * // at boot, once the handlers are registered:
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

  let write = (tx: Tx, eid: Eid, effect: Comp) =>
    tx.patch([{ entity: { eid }, effect }])

  // The end of a run, either way: the verdict, and the claim let go.
  let settle = (tx: Tx, eid: Eid, state: 'done' | 'failed') =>
    write(tx, eid, {
      state,
      lease_owner: null,
      lease_token: null,
      lease_expiry: null,
    })

  let around: Around = (job, tx, next) => {
    let eid = mint()
    return then(
      write(tx, eid, {
        handler: job.handler,
        target: job.event.entity.eid,
        comp: job.event.name,
        kind: job.event.kind,
        state: 'pending',
        attempts: 1,
        at: stamp(clock()),
      }),
      () => {
        // The handler's own failure still belongs to the caller — the registry
        // isolates it — so the row is marked and the throw goes on.
        let raise = (err: unknown) =>
          then(settle(tx, eid, 'failed'), (): never => {
            throw err
          })
        try {
          let out = next()
          return isPromise(out)
            ? out.then((v) => then(settle(tx, eid, 'done'), () => v), raise)
            : then(settle(tx, eid, 'done'), () => out)
        } catch (err) {
          return raise(err)
        }
      },
    )
  }

  // One interrupted row: claim it, rebuild the event it was recorded for, run
  // the handler once more, mark the verdict.
  let retry = (
    fx: Effects,
    tx: Tx,
    eid: Eid,
    row: Comp,
  ): boolean | Promise<boolean> => {
    let attempts = Number(row.attempts ?? 0)
    let expiry = row.lease_expiry ? Date.parse(String(row.lease_expiry)) : 0
    // Somebody else is on it, and their claim still stands.
    if (expiry > clock() && row.lease_owner != opts.owner) return false
    // Its one retry is spent: a second one could double an effect that
    // already reached the world.
    if (attempts >= LIMIT) return then(settle(tx, eid, 'failed'), () => false)
    let name = String(row.comp)
    return then(
      write(tx, eid, {
        attempts: attempts + 1,
        lease_owner: opts.owner,
        lease_token: mint(),
        lease_expiry: stamp(clock() + hold),
      }),
      () =>
        then(tx.get([String(row.target)]), ([found]) => {
          let kind = String(row.kind) as Kind
          return then(
            fx.attempt(String(row.handler), {
              kind,
              entity: found?.entity ?? { eid: String(row.target) },
              name,
              comp: kind == 'removed'
                ? undefined
                : found?.[name] as Comp | undefined,
            }, tx),
            (ok) => then(settle(tx, eid, ok ? 'done' : 'failed'), () => true),
          )
        }),
    )
  }

  return {
    around,
    reconcile: (fx, tx) =>
      then(
        tx.read(and(eq('effect.state', 'pending'))),
        (rows) =>
          each(
            rows,
            0,
            (n, b) =>
              then(
                retry(fx, tx, b.entity.eid, (b.effect ?? {}) as Comp),
                (ran) => n + (ran ? 1 : 0),
              ),
          ),
      ),
  }
}
