// A graph: a vocabulary, a storage, and the plugins that extend what `apply()`
// does. This file is the assembly — the phase list, the core's own work at
// each phase, and the transaction the middle of the list runs inside.
//
// Everything here is per INSTANCE. There is no module-global registry of
// plugins, effects or hooks: two graphs in one process (a page's local graph
// and its mirror of the server's, a test's fixture beside a live store) have
// nothing to say to each other, and a plugin registered on one is invisible to
// the other.
//
// The shape of a run, once:
//
//   normalize   hooks    pure, before the transaction opens
//   admit       core     drop the unknown, refuse the wrong, check the values
//   mint        core     name every $alias, and rewrite what points at it
//   ───────────────────  the transaction opens
//   gather      core     every read the batch is going to need, in one call
//   precondition core    the `$was` guard   (a lease check is a hook here)
//   mutate      core     the patches go in
//   cascade     core     death spreads; casualties join the batch
//   stamp       core     created / updated
//   journal     hooks    the record of what happened
//   commit      hooks    the last word inside the transaction
//   ───────────────────  the transaction commits (or rolls back on a throw)
//   effect      hooks    post-commit observers, each isolated
//   audit       hooks    after a rollback, with what ended it
//
// `apply()` returns the batch AS APPLIED plus everything it synthesized —
// casualties, births with their number, stamps — so a client that applies the
// return to its cache lands exactly where the graph is. It is answered ONE
// BUNDLE PER ENTITY (./compose.ts): the phases each add their own patch, and
// composing them is the last thing this file does, so no caller has to merge
// three bundles to see the one entity it just wrote. The `$` keys are the
// pipeline's and come off there; the raw phase output is what every hook sees
// inside the pipeline, and what a dry run's {@link Checked} carries.
//
// `check: true` runs that whole list and then refuses the commit, so a caller
// spreading one batch over several graphs can ask them all "would you take
// this?" before any of them keeps it. That rollback is a rollback like any
// other — the audit hooks see it, wearing a `Checked` — so a hook that wrote
// inside the transaction is never left believing its rows are still there.

import type { Vocab } from '@yaks/vocab'
import type { Bundle, Change, Eid } from './bundle.ts'
import type { Row, Storage, Tx } from './storage.ts'
import { detached, type Query, type ReadOpts } from './storage.ts'
import type { Hook, Phase, Plugin } from './plugin.ts'
import { type Derive, resolve } from './alias.ts'
import { admit } from './admit.ts'
import { composed } from './compose.ts'
import { type Ask, gather, holding, reached } from './gather.ts'
import { guard } from './guard.ts'
import { mutate } from './mutate.ts'
import { cascade } from './cascade.ts'
import { stamp } from './stamp.ts'
import { state } from './state.ts'
import { each, isPromise, then } from './pipe.ts'

/** What one `apply()` call may say about itself. */
export type ApplyOpts = {
  /** the caller is trusted server code: server-owned columns are admitted */
  trusted?: boolean
  /** the instant every stamp in this batch reads, ISO-8601 (default: now) */
  now?: string
  /** a DRY RUN: every phase runs and the transaction is rolled back instead of
   * committed, so nothing is written and no effect observes it. The answer is
   * the batch the phases made, composed like any other — a refusal still
   * throws, which is the whole point of asking. The audit hooks see the
   * rollback (see {@link Checked}). */
  check?: boolean
}

/**
 * A dry run's way out of a transaction that has done all its work. The phases
 * ran; the only thing left is the commit, which is exactly what a check must
 * not do — so the body throws this, the adapter rolls back, and `apply()`
 * catches it and answers with the batch instead.
 *
 * It reaches the `audit` hooks, which is the whole reason it is a value a hook
 * can name: a hook that wrote inside the transaction — or that KEPT A NOTE of
 * having written — must hear that the rows are gone, and `audit` is where this
 * package says so. A hook that RECORDS a refusal should ignore it: nothing was
 * refused, and a rehearsal is not an incident.
 */
export class Checked extends Error {
  /** the batch as the phases made it, RAW — one patch per phase, the `$` keys
   * still on. `apply()` composes it (./compose.ts) before answering. */
  bundles: Bundle[]
  constructor(bundles: Bundle[]) {
    super('checked')
    this.name = 'Checked'
    this.bundles = bundles
  }
}

/** How a graph is built: what it knows, where it keeps it, what extends it. */
export type Options = {
  /** where the bytes live */
  storage: Storage
  /** the loaded component vocabulary — the same one the storage is bound to */
  vocab: Vocab
  /** the plugins whose hooks run in `apply()` */
  plugins?: Plugin[]
  /** where a failing effect is reported (default: `console.warn`) */
  report?: (err: unknown, at: { phase: Phase; plugin: string }) => void
  /** what names an entity a batch minted under an alias, when no component
   * derives its own id (default: `crypto.randomUUID()`) */
  mint?: () => Eid
}

/** A live graph: what it knows, and the four things you can do with it. */
export type Graph = {
  /** the component vocabulary this graph speaks */
  vocab: Vocab
  /** the adapter that owns the bytes */
  storage: Storage
  /** the plugins registered on this graph, in order */
  plugins: Plugin[]
  /** register another plugin (its hooks join the ones already there) */
  use: (plugin: Plugin) => Graph
  /** the schema statements this graph's vocabulary implies */
  ddl: () => string[]
  /** create the tables and indexes it needs */
  install: () => void | Promise<void>
  /** a query → the matching entities as whole bundles */
  read: (query: Query, opts?: ReadOpts) => Bundle[] | Promise<Bundle[]>
  /** a query → the compiled statement's raw rows */
  rows: (query: Query, opts?: ReadOpts) => Row[] | Promise<Row[]>
  /** apply a batch atomically → the batch as applied, one bundle per entity,
   * plus what it synthesized */
  apply: (change: Change, opts?: ApplyOpts) => Bundle[] | Promise<Bundle[]>
}

// One step of the pipeline: the batch in, the batch the next step sees out.
type Step = (bundles: Bundle[]) => Bundle[] | Promise<Bundle[]>

let warn = (err: unknown, at: { phase: Phase; plugin: string }) =>
  console.warn(`${at.plugin} failed at ${at.phase} —`, err)

/**
 * Build a graph over a storage and a vocabulary. The vocabulary must be the
 * one the storage is bound to (load every plugin's documents, bind the
 * storage, then hand the same plugins here — see `vocabOf` in ./plugin.ts).
 */
export let graph = (opts: Options): Graph => {
  let { storage, vocab } = opts
  let plugins = [...(opts.plugins ?? [])]
  let report = opts.report ?? warn
  let mint = opts.mint ?? (() => crypto.randomUUID() as Eid)

  // Every content-addressed component's naming function, by component name.
  // Read per apply, so a plugin registered later is in.
  let derives = (): Record<string, Derive> =>
    Object.assign({}, ...plugins.map((p) => p.derive ?? {}))

  // Every read this batch is going to need: the core's own — every entity the
  // batch names or points at, which is what the `$was` guard, `mutate` and the
  // storage's own minting all ask about — plus whatever each plugin declares.
  let asking = (bundles: Bundle[]): Ask[] => [
    { eids: reached(bundles, vocab) },
    ...plugins.flatMap((p) => p.wants?.(bundles) ?? []),
  ]

  // The hooks registered on a phase, in plugin registration order.
  let hooks = (phase: Phase): [string, Hook][] =>
    plugins.flatMap((p) => {
      let h = p.hooks?.[phase]
      return h ? [[p.name, h] as [string, Hook]] : []
    })

  // A phase: the core's own work first (it is what the hooks are extending),
  // then each hook, each seeing what the one before it returned.
  let phase = (name: Phase, tx: Tx, core?: Step): Step => (bundles) => {
    let steps: Step[] = core ? [core] : []
    for (let [, h] of hooks(name)) steps.push((b) => h(b, tx))
    return each(steps, bundles, (b, step) => step(b))
  }

  let apply = (change: Change, o: ApplyOpts = {}):
    | Bundle[]
    | Promise<
      Bundle[]
    > => {
    let st = state()
    let now = o.now ?? new Date().toISOString()
    let outside = detached(storage)

    // After the transaction: every effect hook, isolated. A failing effect is
    // telemetry — the batch is already committed and a broken observer must
    // not turn a good write into an error.
    let effects = (applied: Bundle[]) =>
      then(
        each(hooks('effect'), applied, (b, [plugin, hook]) => {
          try {
            let out = hook(b, outside)
            return isPromise(out)
              ? out.catch((e) => {
                report(e, { phase: 'effect', plugin })
                return b
              })
              : out
          } catch (e) {
            report(e, { phase: 'effect', plugin })
            return b
          }
        }),
        () => applied,
      )

    // After a rollback: the audit hooks, with what caused it — a refusal, or
    // the {@link Checked} marker a dry run rolls back with. They run OUTSIDE
    // the dead transaction (an audit row cannot ride the batch it condemns).
    // Every rollback runs them, because a hook that wrote inside the
    // transaction has to hear that its rows are gone whichever ended it.
    let auditing = (bundles: Bundle[], err: unknown) =>
      each(hooks('audit'), bundles, (b, [plugin, hook]) => {
        try {
          let out = hook(b, outside, err)
          return isPromise(out)
            ? out.catch((e) => {
              report(e, { phase: 'audit', plugin })
              return b
            })
            : out
        } catch (e) {
          report(e, { phase: 'audit', plugin })
          return b
        }
      })

    // A refusal is audited and then rethrown — auditing never swallows.
    let audited = (bundles: Bundle[], err: unknown): never | Promise<never> => {
      let raise = (): never => {
        throw err
      }
      let done = auditing(bundles, err)
      return isPromise(done) ? done.then(raise) : raise()
    }

    let inside = (bundles: Bundle[]) => {
      let run = (tx: Tx) =>
        // Every read the phases before the patches will make, taken as one
        // call. It is handed to THOSE phases alone — a snapshot of the graph as
        // the batch found it is exactly what a precondition wants, and exactly
        // what a phase reading after the patches must not have. `mutate` is one
        // of them: it reads which entities are already dead before it writes a
        // thing, and a patch through the gathered transaction is folded back
        // into the snapshot, so the phases still read each other.
        then(gather(tx, vocab, asking(bundles)), (snap) => {
          let held = holding(tx, vocab, snap)
          return then(
            each(
              [
                phase('precondition', held, (b) => guard(b, held, vocab)),
                phase('mutate', held, (b) => mutate(b, held, st)),
                phase('cascade', tx, (b) => cascade(b, tx, vocab, st)),
                phase('stamp', tx, (b) => stamp(b, tx, vocab, st, now)),
                phase('journal', tx),
                phase('commit', tx),
              ],
              bundles,
              (b, step) => step(b),
            ),
            (b) => {
              if (o.check) throw new Checked(b)
              return b
            },
          )
        })
      // A rolled-back check is not a refusal: it is audited like any other
      // rollback, then answers with what the phases made, and skips the
      // effects, which observe committed data only.
      let fell = (e: unknown) =>
        e instanceof Checked
          ? then(auditing(bundles, e), () => e.bundles)
          : audited(bundles, e)
      let committed: Bundle[] | Promise<Bundle[]>
      try {
        committed = storage.tx(run)
      } catch (e) {
        return fell(e)
      }
      return isPromise(committed)
        ? committed.then(effects, fell)
        : effects(committed)
    }

    // The run, end to end: the phases before the transaction, the transaction,
    // and then the ANSWER — composed once, where every way out of `apply()`
    // passes, the commit and a dry run's rollback alike.
    return each(
      [
        phase('normalize', outside),
        phase('admit', outside, (b) => admit(b, vocab, o.trusted)),
        phase('mint', outside, (b) => resolve(b, vocab, derives(), mint)),
        inside,
        composed,
      ],
      change,
      (b, step) => step(b),
    )
  }

  let g: Graph = {
    vocab,
    storage,
    plugins,
    use: (plugin) => {
      plugins.push(plugin)
      return g
    },
    ddl: () => storage.ddl(),
    install: () => storage.install(),
    read: (query, readOpts) => storage.read(query, readOpts),
    rows: (query, readOpts) => storage.rows(query, readOpts),
    apply,
  }
  return g
}
