// A graph: a vocabulary, a storage adapter, and the plugins that extend what
// `apply()` does. This file is the assembly — the phase list, the core's own
// work at each phase, and the transaction the middle of the list runs inside.
//
// Everything here is per INSTANCE. There is no module-global registry of
// plugins, effects or hooks: two graphs in one process (a page's local graph
// and its mirror of the server's, or a test fixture beside a live store) share
// nothing, and a plugin registered on one is invisible to the other.
//
// One run, in order:
//
//   normalize   hooks    pure, before the transaction opens
//   admit       core     drop undeclared columns, refuse invalid ones, check
//                        the values
//   mint        core     assign an id to every $alias, and rewrite the
//                        references to it
//   ───────────────────  the transaction opens
//   gather      core     every read this change is going to need, in one call
//   precondition core    the `$was` check   (a lease check is a hook here)
//   rules       rules    the declarative half, over the change as an overlay
//   mutate      core     the patches are written
//   cascade     core     deletions spread; the entities they take join the
//                        change
//   stamp       core     created / updated
//   journal     hooks    the record of what happened
//   commit      hooks    the last chance to act inside the transaction
//   ───────────────────  the transaction commits (or rolls back on a throw)
//   effect      rules/hooks post-commit observers, each isolated
//   audit       hooks    after a rollback, with the error that caused it
//
// `apply()` returns the change AS APPLIED plus everything it generated —
// entities the cascade deleted, entities created with their assigned number,
// stamps — so a client that applies the return value to its cache ends up
// exactly where the graph is. It returns ONE BUNDLE PER ENTITY
// (./compose.ts): each phase adds its own patch, and composing them is the
// last thing this file does, so no caller has to merge three bundles to see
// the one entity it just wrote. The `$` keys belong to the write pipeline and
// are stripped there; the uncomposed phase output is what every hook sees
// inside the pipeline, and what a dry run's {@link Checked} carries.
//
// `check: true` runs that whole list and then refuses the commit, so a caller
// spreading one change over several graphs can ask them all "would you accept
// this?" before any of them keeps it. That rollback is a rollback like any
// other — the audit hooks see it, carrying a `Checked` error — so a hook that
// wrote inside the transaction is never left believing its rows are still
// there.

import { rulesIn, type Vocab } from '@yaks/vocab'
// getRandomValues, never crypto.randomUUID: a page served over plain http
// generates ids too, and randomUUID is unavailable there.
import { mint as fresh } from '@yaks/id'
import {
  type Actor,
  type Bundle,
  type Change,
  comps,
  type Eid,
} from './bundle.ts'
import type { Row, Storage, Tx } from './storage.ts'
import { detached, type Query, type ReadOpts } from './storage.ts'
import type { Hook, Phase, Plugin, Tracker, WriteHook } from './plugin.ts'
import { type Derive, resolve } from './alias.ts'
import { identified, identities } from './identity.ts'
import { admit } from './admit.ts'
import { composed } from './compose.ts'
import { type Ask, complete, gather, holding, reached } from './gather.ts'
import { guard } from './guard.ts'
import { mutate } from './mutate.ts'
import { ordered } from './ordered.ts'
import { cascade } from './cascade.ts'
import {
  actorOf,
  births,
  marks,
  provenance,
  signed,
  type StampPolicy,
} from './stamp.ts'
import { fire, registry, type Resource, type Rule, stands } from './rules.ts'
import { ready, settle } from './declared.ts'
import { state } from './state.ts'
import { each, isPromise, then } from './pipe.ts'
import { addressing } from './said.ts'
import { meaning } from './meant.ts'

/** The options one `apply()` call can pass. */
export type ApplyOpts = {
  /** the caller is trusted server code: server-owned columns are accepted */
  trusted?: boolean
  /** the timestamp every stamp in this change uses, ISO-8601 (default: now) */
  now?: string
  /** a DRY RUN: every phase runs and the transaction is rolled back instead of
   * committed, so nothing is written and no effect observes it. The return
   * value is the change the phases produced, composed like any other — a
   * refusal still throws, which is the whole point of asking. The audit hooks
   * see the rollback (see {@link Checked}). */
  check?: boolean
}

/**
 * How a dry run leaves a transaction that has done all its work. The phases
 * have run; the only thing left is the commit, which is exactly what a check
 * must not do — so the transaction body throws this, the adapter rolls back,
 * and `apply()` catches it and returns the change instead.
 *
 * It reaches the `audit` hooks, which is the whole reason it is an exported
 * class a hook can check for: a hook that wrote inside the transaction — or
 * that recorded somewhere that it had written — must be told the rows are
 * gone, and `audit` is where that is reported. A hook that RECORDS refusals
 * should ignore it: nothing was refused, and a dry run is not an incident.
 */
export class Checked extends Error {
  /** the change as the phases produced it, UNCOMPOSED — one patch per phase,
   * with the `$` keys still on it. `apply()` composes it (./compose.ts) before
   * returning. */
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
  /** whose graph this is: the actor used to sign a change that names none.
   * The program's own writes — its rules, its effects, the pass it makes at
   * startup, a bulk import — arrive with nothing to attribute them to, and are
   * stored attributed to this actor rather than to nobody. An HTTP or MCP
   * server that authenticated somebody overrides this before the change ever
   * reaches `apply()` (`signed`). */
  actor?: Actor
  /** Per-entity provenance policy; the core keeps the stamp mechanism. */
  provenance?: StampPolicy
  /** the calling program's provenance clock, sampled once when a rule first
   * asks for #Now. `ApplyOpts.now` takes precedence. The default is still the
   * time the apply started. */
  clock?: () => string
  /** a calling program with an enclosing transaction of its own may queue
   * observers until THAT transaction commits. Discard the queue on rollback.
   * Deferred observers do not change what this apply returns; any writes they
   * make are separate operations. */
  deferEffects?: (run: () => void | Promise<void>) => void
  /** where a failing effect is reported (default: `console.error`) */
  report?: (err: unknown, at: { phase: Phase; plugin: string }) => void
  /** how to generate an id for an entity written under an alias, when no
   * component derives its own id (default: `mint()` from the id package) */
  mint?: () => Eid
}

/** A live graph: what it knows, and what you can do with it. */
export type Graph = {
  /** the component vocabulary this graph uses */
  vocab: Vocab
  /** the adapter that stores the data */
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
  /** the ids a caller passed → the eids they refer to, for the ones that are
   * not eids already (see {@link Plugin.address}). Only the ids that CHANGED
   * are in the returned map, so a caller reads it as `at.get(id) ?? id`; with
   * no plugin resolving names, every id is itself and this costs nothing. */
  address: (ids: string[]) => Map<string, Eid> | Promise<Map<string, Eid>>
  /** apply a change in one transaction → the change as applied, one bundle per
   * entity, plus everything the pipeline generated */
  apply: (change: Change, opts?: ApplyOpts) => Bundle[] | Promise<Bundle[]>
}

// One step of the pipeline: the bundles in, the bundles the next step sees
// out.
type Step = (bundles: Bundle[]) => Bundle[] | Promise<Bundle[]>

let failed = (err: unknown, at: { phase: Phase; plugin: string }) =>
  console.error(`${at.plugin} failed at ${at.phase} —`, err)

/**
 * Build a graph over a storage and a vocabulary. The vocabulary must be the
 * one the storage is bound to (load every plugin's documents, bind the
 * storage, then hand the same plugins here — see `vocabOf` in ./plugin.ts).
 */
export let graph = (opts: Options): Graph => {
  let { storage, vocab } = opts
  let plugins = [...(opts.plugins ?? [])]
  let report = opts.report ?? failed
  let mint = opts.mint ?? (() => fresh() as Eid)

  // What the VOCABULARY derives for itself: every component declaring an
  // `identity` derives its entity's id from that value (identity.ts). Fixed
  // for the life of this graph, because the vocabulary is.
  let declared = identities(vocab)

  // Every content-addressed component's id-deriving function, by component
  // name. Read once per apply, so a plugin registered later is included. A
  // plugin's own `derive` takes precedence: @yaks/edge and @yaks/key derive an
  // entity's id from the relation component it carries, which a list of
  // columns cannot express.
  let derives = (): Record<string, Derive> =>
    Object.assign({}, declared, ...plugins.map((p) => p.derive ?? {}))

  // Every read this change is going to need: the core's own — every entity the
  // change names or references, which is what the `$was` check, `mutate` and
  // storage's own number assignment all need — plus whatever each plugin
  // declares.
  let asking = (bundles: Bundle[]): Ask[] => [
    {
      eids: reached(bundles, vocab),
      select: [
        'tombstone',
        ...bundles.flatMap((b) => comps(b).map(([name]) => name)),
      ],
    },
    ...plugins.flatMap((p) => p.wants?.(bundles) ?? []),
  ]

  // The hooks registered on a phase, in plugin registration order.
  let hooks = (phase: Phase): [string, Hook][] =>
    plugins.flatMap((p) => {
      let h = p.hooks?.[phase]
      return h ? [[p.name, h] as [string, Hook]] : []
    })

  // The rules registered on a phase: the core's own (the stamps), then each
  // plugin's, in registration order.
  // The marks come from the VOCABULARY, so a program that replaces the
  // created/updated pair with a policy of its own still gets them.
  let stamping = [...provenance(opts.provenance), ...marks(vocab)]
  // The DECLARED rules, read once per apply: a plugin registered since the
  // last apply is included, and a rule that will not parse throws before the
  // change opens a transaction.
  //
  // Most of them come from the graph's OWN vocabulary, because that is where
  // an app's `vocab.json` ends up — so an app that ships a `rule: true` entry
  // runs it with no wiring at all. A plugin registered after the graph was
  // built carries documents the loaded vocabulary never saw, so those are read
  // too.
  let declaring = () => {
    let seen = new Set(vocab.docs)
    // A rule that DECLARES another phase is not run by this one: @yaks/tools'
    // call/result rules name `effect`, and the runner that asks them for their
    // bindings runs post-commit. A rule that declares no phase belongs to the
    // `rules` phase, which is what a rule means unless it declares otherwise.
    let here = (r: { phase?: string }) => !r.phase || r.phase == 'rules'
    return ready([
      ...rulesIn(vocab.docs).filter(here),
      ...plugins.flatMap((p) => [
        ...(p.declared ?? []),
        ...rulesIn((p.vocab ?? []).filter((d) => !seen.has(d))).filter(here),
      ]),
    ])
  }
  let ruled = (phase: Phase): Rule[] =>
    [...stamping, ...plugins.flatMap((p) => p.rules ?? [])]
      .filter((r) => r.phase == phase)

  // The singletons a rule may bind with `#Name`: each plugin's, then this
  // graph's own three, which take precedence — nothing a plugin registers can
  // change the transaction's timestamp or its actor out from under the stamps.
  let resourced = (now: () => string): Record<string, Resource> =>
    registry([
      ...plugins.map((p) => p.resources),
      {
        Vocab: () => vocab,
        Now: () => stands({ at: now() }),
        // A copy, so a rule cannot mutate the change's own `$actor`.
        Actor: (tick) => {
          let who = actorOf(tick.bundles)
          return stands({ ...who }, who.by)
        },
      },
    ])

  // A change that names no writer is this graph's OWN — nobody authenticated
  // it because there was no request: a rule's effect, a startup pass, a bulk
  // import by the process that holds the file. It is attributed to the calling
  // program rather than to nobody, so every write has an author and the
  // journal has a name to record. A server that authenticated somebody
  // overrides this (`signed`) before the change gets here.
  let owned = (change: Change): Change =>
    opts.actor && !change.some((b) => b.$actor)
      ? signed(change, opts.actor)
      : change

  let apply = (change: Change, o: ApplyOpts = {}):
    | Bundle[]
    | Promise<
      Bundle[]
    > => {
    let st = state()
    let now = o.now ?? new Date().toISOString()
    let instant: string | undefined
    let outside = detached(storage)
    // One registry for the whole apply, so `#Now` is one instant however many
    // phases and rules read it.
    let resources = resourced(() => instant ??= o.now ?? opts.clock?.() ?? now)

    // A phase: the core's own work first (it is what the rules and hooks
    // extend), then the rules evaluated together, then each hook, each seeing
    // what the one before it returned. `of` is how a rule sees what the graph
    // already holds, beyond this change; a phase with nothing gathered leaves
    // it out.
    let phase = (
      name: Phase,
      tx: Tx,
      core?: Step,
      of?: (eid: Eid) => Bundle | undefined,
    ): Step =>
    (bundles) => {
      let steps: Step[] = core ? [core] : []
      let rules = ruled(name)
      if (rules.length) {
        steps.push((b) =>
          fire(rules, { vocab, tx, phase: name, bundles: b, resources, of })
        )
      }
      for (let [, h] of hooks(name)) steps.push((b) => h(b, tx))
      return each(steps, bundles, (b, step) => step(b))
    }

    // After the transaction: every effect rule, then every hook, each isolated
    // from the others. A failing observer is only reported — the transaction
    // has already committed.
    let observed = (
      plugin: string,
      b: Bundle[],
      run: () => ReturnType<Step>,
    ) => {
      let failed = (e: unknown) => {
        report(e, { phase: 'effect', plugin })
        return b
      }
      try {
        let out = run()
        return isPromise(out) ? out.catch(failed) : out
      } catch (e) {
        return failed(e)
      }
    }

    let effects = (applied: Bundle[]) => {
      let rules = plugins.flatMap((p) =>
        (p.rules ?? []).filter((r) => r.phase == 'effect')
          .map((r) => [p.name, r] as const)
      )
      // Rules see the whole entity, including components this write left out.
      // Freeze that view once, before any observer acts; each rule runs on its
      // own for isolation, but they share the phase's resources and the same
      // starting state.
      let run = () =>
        then(
          outside.get([...new Set(applied.map((b) => b.entity.eid))]),
          (rows) => {
            let held = new Map(rows.map((b) => [b.entity.eid, b]))
            let values = new Map<string, unknown>()
            let shared = Object.fromEntries(
              Object.entries(resources).map(([name, make]) => [
                name,
                ((tick) => {
                  if (!values.has(name)) values.set(name, make(tick))
                  return values.get(name)
                }) as Resource,
              ]),
            )
            return each(rules, applied, (b, [plugin, rule]) =>
              observed(plugin, b, () =>
                then(
                  fire([rule], {
                    vocab,
                    tx: outside,
                    phase: 'effect',
                    bundles: applied,
                    resources: shared,
                    of: (eid) =>
                      held.get(eid),
                  }),
                  (made) => [...b, ...made.slice(applied.length)],
                )))
          },
        )
      let made = rules.length ? observed('graph', applied, run) : applied
      return then(made, (b) =>
        then(
          each(hooks('effect'), b, (out, [plugin, hook]) =>
            observed(plugin, out, () =>
              hook(out, outside))),
          () =>
            b,
        ))
    }

    // After a rollback: the audit hooks, with the error that caused it — a
    // refusal, or the {@link Checked} error a dry run rolls back with. They
    // run OUTSIDE the rolled-back transaction, because an audit row cannot be
    // written in the transaction it is recording the failure of. Every
    // rollback runs them, because a hook that wrote inside the transaction has
    // to be told its rows are gone, whatever ended it.
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
        // Every read the phases before the write will make, taken as one call.
        // It is handed to THOSE phases alone — a snapshot of the graph as the
        // change found it is exactly what a precondition needs, and exactly
        // what a phase reading after the write must not have. `mutate` is one
        // of them: it reads which entities are already deleted before it
        // writes anything, and a patch made through the gathered transaction
        // is folded back into the snapshot, so those phases still see each
        // other's writes.
        then(gather(tx, vocab, asking(bundles)), (snap) => {
          let trackers: Tracker[] = []
          for (let p of plugins) {
            if (!p.track) continue
            let tracker = p.track(tx, (eid) => snap.got.get(eid))
            trackers.push(tracker)
            tx = tracker.tx
          }
          let flush: Step = (b) => each(trackers, b, (out, t) => t.flush(out))
          let held = holding(tx, vocab, snap)
          // What the graph holds for one entity, with every patch this change
          // has made already folded in — what a rule is evaluated against
          // (./rules.ts).
          let holds = (eid: Eid) => snap.got.get(eid) ?? undefined
          let checks: WriteHook[] | undefined
          return then(
            each(
              [
                phase('precondition', held, (b) => guard(b, held, vocab)),
                // The declared rules, before any row of the change is
                // written: what they produce joins the change, and `mutate`
                // writes it like anything else.
                phase(
                  'rules',
                  held,
                  (b) => {
                    let rules = declaring()
                    if (!rules.length) return b
                    // A resource a declared rule WRITES (`+result.at=#Now`)
                    // is the same singleton the rules written in code read,
                    // built at most once and only if something asks for it.
                    let kept = new Map<string, unknown>()
                    let ask = (name: string) => {
                      if (!kept.has(name)) {
                        kept.set(
                          name,
                          resources[name]?.({
                            vocab,
                            tx: held,
                            phase: 'rules',
                            bundles: b,
                            resources,
                            of: holds,
                          }),
                        )
                      }
                      return kept.get(name)
                    }
                    return settle(
                      rules,
                      b,
                      held,
                      vocab,
                      ask,
                      (made) => admit(made, vocab, true),
                    )
                  },
                  holds,
                ),
                phase('mutate', held, (b) => {
                  checks = plugins.flatMap((p) =>
                    p.beforeWrite ? [p.beforeWrite(b)] : []
                  )
                  return checks.length
                    ? ordered(b, tx, vocab, snap, st, checks)
                    : mutate(b, held, st)
                }),
                phase('cascade', tx, (b) =>
                  then(b.length ? complete(tx, snap) : undefined, () =>
                    checks?.length ? b : cascade(b, tx, vocab, st))),
                // The stamps are rules, and they ask what the graph already
                // holds for an entity: a newly created entity is one with no
                // `created` component.
                phase('stamp', tx, (b) =>
                  births(b, st), holds),
                flush,
                phase('journal', tx),
                phase('commit', tx),
                flush,
              ],
              bundles,
              (b, step) =>
                step(b),
            ),
            (b) => {
              if (o.check) {
                throw new Checked(b)
              }
              return b
            },
          )
        })
      // A rolled-back dry run is not a refusal: it is audited like any other
      // rollback, then returns what the phases produced, and skips the
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
      let observe = (b: Bundle[]) => {
        if (!opts.deferEffects) return effects(b)
        // Sample the calling program's clock while its transaction-scoped
        // context still exists.
        instant ??= o.now ?? opts.clock?.() ?? now
        opts.deferEffects(() => then(effects(b), () => {}))
        return b
      }
      return isPromise(committed)
        ? committed.then(observe, fell)
        : observe(committed)
    }

    // The run, end to end: the phases before the transaction, the transaction,
    // and then the RETURN VALUE — composed once, at the point every exit from
    // `apply()` passes through, the commit and a dry run's rollback alike.
    return each(
      [
        phase('normalize', outside),
        phase('admit', outside, (b) => admit(b, vocab, o.trusted)),
        // Derive the id, then check it still matches: an id derived from a
        // value is only meaningful while the two agree (identity.ts
        // `identified`).
        phase(
          'mint',
          outside,
          (b) => identified(resolve(b, vocab, derives(), mint), vocab),
        ),
        inside,
        composed,
      ],
      owned(change),
      (b, step) => step(b),
    )
  }

  // The same convenience a tool's arguments get (tool.ts `addressed`), applied
  // to a query string: wherever the query names an entity, an id a person can
  // type is resolved to the eid the store keys rows by (said.ts).
  let aim = addressing(vocab)

  // The other half of reading a query the way it was meant: a bare column name
  // the vocabulary cannot place on its own is resolved to the component the
  // query already selects (meant.ts). Both run before storage sees the query,
  // so every caller reading through this graph gets the same interpretation.
  let mean = meaning(vocab)

  // What a caller asks before reading by id: every plugin that knows how a
  // name becomes an eid, asked in turn, each about the ids no earlier plugin
  // resolved. It runs outside any transaction — the caller is asking before it
  // does anything.
  let address = (ids: string[]) => {
    let asks = plugins.flatMap((p) => p.address ?? [])
    if (!asks.length || !ids.length) return new Map<string, Eid>()
    let outside = detached(storage)
    return each(asks, new Map<string, Eid>(), (at, ask) =>
      then(
        ask(outside, ids.filter((id) => !at.has(id))),
        (more) => new Map([...at, ...more]),
      ))
  }

  let g: Graph = {
    vocab,
    storage,
    plugins,
    address,
    use: (plugin) => {
      plugins.push(plugin)
      return g
    },
    ddl: () => storage.ddl(),
    install: () => storage.install(),
    read: (query, readOpts) =>
      then(aim(mean(query), address), (q) => storage.read(q, readOpts)),
    rows: (query, readOpts) =>
      then(aim(mean(query), address), (q) => storage.rows(q, readOpts)),
    apply,
  }
  return g
}
