// The registry: which handlers are registered, and what running them means.
//
// A registration is a slot — a component name, one of the things that can
// happen to it, and (for a change) the property that has to have moved.
// Handlers are matched by slot rather than by a filter function, so what a
// graph will do about a write can be listed, and so a handler watching one
// property is never run for a batch that moved a different one.
//
// A slot is made one of two ways, and they meet in the middle. `created` and
// `changed` describe what moved, which no reading of the committed rows
// recovers, so they are registered as themselves. A pattern is a query, run
// wherever this batch made it true. `removed` used to be a third thing and is
// not any more: `-comp` (@yaks/query) means a batch removed a component, so
// `fx.removed('post')` is `fx.on('-post')` and the slot it makes is read off
// the pattern. A pattern with no other clause is folded back into the removal
// event it describes (`solo` below) — an event already reports exactly that,
// and that is what keeps a cascade's casualties, and an external journal's
// `removed` events, firing.
//
// Two rules hold, and they are the reason effects are a separate phase:
//
//   Post-commit only. Handlers run after the transaction returned, so what
//   they read is settled and nothing they do can reject the write. A batch
//   that was refused never reaches this phase at all.
//
//   Isolated. Every handler runs inside its own try — a throw, or a rejected
//   promise, is passed to `report` and the next handler still runs. A broken
//   handler must not break the thing it was watching, and the write is
//   already durable by then anyway.
//
// A handler that returns a promise is awaited, which is @yaks/graph's sync
// pass-through working as designed: a graph whose effects are all synchronous
// keeps a synchronous `apply()`, and the first asynchronous handler makes that
// one call's return value a promise. A handler that must not delay its caller
// starts its own work and returns nothing.
//
// A handler that writes is handed a third argument: the write callback
// (./write.ts), which puts its bundles through the graph's own `apply()` as a
// new batch — a list of changes applied in one transaction. The loop that
// invites is stopped by the generation number that callback sets and this file
// reads, never by a rule each handler has to remember.

import type { Bundle, Comp, Eid, Hook, Match, Plugin, Tx } from '@yaks/graph'
import { asked, isPromise, match, over, reads, then } from '@yaks/graph'
import type { Clause } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import {
  before,
  type Event,
  events,
  type Kind,
  strip,
  wanting,
} from './trace.ts'
import { generation, marked, ORIGIN, unmark, type Write } from './write.ts'
import {
  describe,
  type Description,
  type Dispatch,
  type Policy,
  type Registration,
  type SweepRows,
} from './registration.ts'
export type {
  Description,
  Dispatch,
  Policy,
  Registration,
  SweepRows,
  Watch,
} from './registration.ts'

/** A post-commit handler: what happened, a detached transaction to read
 * through, and the callback to write through ({@link Write}). Its return value
 * is awaited when it is a promise. */
export type Handler = (event: Event, tx: Tx, write: Write) => unknown

/** One registration: the component it watches, what has to happen to it, and
 * the handler. `id` is its name — `post.created`, `post.changed.published`,
 * `post.removed`, with `#2` appended when the same slot is registered
 * twice. */
export type Slot = Policy & {
  /** Related hooks registered in one on() call. */
  group?: string
  /** the registration's name, unique within one registry */
  id: string
  /** the component name it watches */
  comp: string
  /** what has to happen to that component */
  kind: Kind
  /** the property that has to have moved, for a `changed` slot that names
   * one */
  prop?: string
  /** a `matched` slot's pattern: the parsed query it was registered with */
  plan?: Match
  /** the components that pattern reads — a batch that moved none of them
   * cannot have changed whether it holds, so it is not asked */
  watch?: string[]
  /** `-comp` — the components the pattern requires this batch to have
   * removed. Only the batch itself can answer that, so a slot naming any is
   * run through `tx.bindings` with the batch passed in, never against the
   * committed rows alone */
  gone?: string[]
  /** the handler itself */
  run: Handler
}

/** One handler about to run, for a {@link Report} or an {@link Around}. */
export type Run = {
  /** the slot's id */
  handler: string
  /** the committed change it is running for */
  event: Event
  /** the registration itself, where there is one — what it declared is how a
   * wrapper knows how many attempts it gets and whether running it twice is
   * safe ({@link Policy}). Absent on a report about a slot nobody
   * registered. */
  slot?: Slot
}

/** Where a failing handler goes. A report is telemetry: it is called instead
 * of the error being thrown, and must not throw itself. */
export type Report = (err: unknown, ctx: Run) => void

/**
 * A wrapper around every handler run: `next()` runs the handler, and whatever
 * this returns is what the dispatch awaits. The durability tier is one of
 * these ({@link https://jsr.io/@yaks/effects/doc/~/ledger | ledger}); so is a
 * timer, a log line, or a queue.
 */
export type Around = (run: Run, tx: Tx, next: () => unknown) => unknown

/** How a registry is built. */
export type Opts = {
  /** where a failing handler is reported (default: `console.warn`) */
  report?: Report
  /** a wrapper around every handler run — durability, timing, logging */
  around?: Around
  /** the plugin's name, for diagnostics (default: `@yaks/effects`) */
  name?: string
  /** how a handler writes back: one new batch through the graph's own
   * `apply()`, trusted (see {@link Write}). Without it a handler that tries to
   * write is reported rather than quietly writing past the pipeline. */
  write?: Write
  /** how many generations of effect-written batches still trigger handlers
   * (default: `1`). A batch from a client is generation 0 and an effect's own
   * write is 1, so the default lets one effect see another's write and stops
   * the generation after that. */
  depth?: number
  /** Default process selection, also used by replay and reconciliation. */
  want?: (where: string) => boolean
}

/**
 * A registry: a {@link https://jsr.io/@yaks/graph | @yaks/graph} plugin, plus
 * the methods that register handlers on it. Registration is chainable and may
 * happen at any time — before the graph is built, or after, which is how a
 * handler closes over the graph it writes back through.
 */
export type Effects = Plugin & {
  /** run when an entity gains this component */
  created: (comp: string, run: Handler, policy?: Policy) => Effects
  /** run when this component is patched — for one property, or for any */
  changed: (
    comp: string,
    prop: string | Handler,
    run?: Handler,
    policy?: Policy,
  ) => Effects
  /** run when this component goes, by its own deletion or with its entity */
  removed: (comp: string, run: Handler, policy?: Policy) => Effects
  /** every registration, in the order they were made */
  slots: () => Slot[]
  /** Whether this registry consumer owns a registered slot. Reconcilers must
   * check before claiming or settling durable work. Unknown ids return false. */
  owns: (id: string) => boolean
  /**
   * Register a handler. Two spellings, because there are two questions:
   *
   *   fx.on('post', { created, changed: { published }, removed })
   *   fx.on('$call .call, !results', (e) => run(e.entity.eid))
   *   fx.on('-post', (e) => unindex(e.entity.eid))
   *
   * The first names a component and what has to happen to it; the second is a
   * pattern — any query, any number of entities — and it runs wherever the
   * batch just made it true. Nothing has to be derived into the graph to
   * trigger it: if a call with no result is what you care about, that query is
   * the registration. The third is the deletion clause: `-comp` means this
   * batch removed the component, which is what `removed` has always meant.
   */
  on: {
    (comp: string, registration: Registration): Effects
    (pattern: string | Match, run: Handler, policy?: Policy): Effects
  }
  /** Documentation derived from the actual registered slots. */
  docs: () => Description[]
  /** Dispatch events from an external committed journal. Runs start eagerly,
   * independently of slow siblings. Without tx, event-only handlers work;
   * attempts to read a transaction fail explicitly and are reported. */
  dispatch: (events: Event[], tx?: Tx, pass?: Dispatch) => Promise<unknown[]>
  /** Re-drive each owned created slot's pending rows. Fetch and handler
   * failures are isolated; no ledger or automatic retry is implied. */
  relay: (rows: SweepRows, tx?: Tx, pass?: Dispatch) => Promise<unknown[]>
  /** run one registration by id, isolated: `true` if it completed, `false` if
   * it failed and was reported. The method a reconciler re-runs through. */
  attempt: (id: string, event: Event, tx: Tx) => boolean | Promise<boolean>
}

let warn: Report = (err, { handler }) =>
  console.warn(`effect ${handler} failed —`, err)

// Whether a slot is watching for this event. A pattern slot watches no single
// event: its query is run against the graph instead (see `hits`).
let watching = (s: Slot, e: Event): boolean =>
  s.kind != 'matched' && s.comp == e.name && s.kind == e.kind &&
  (s.kind != 'changed' || !s.prop || (!!e.comp && s.prop in e.comp))

// What a pattern is about, in one component name: the first component it
// requires. It names the slot and rides on the event, so a pattern effect
// lists alongside the component ones.
let about = (plan: Match): string => {
  for (let p of plan.patterns) {
    for (let c of p.filter.clauses) {
      if (c.kind == 'pred' && c.op == '!' && c.path.length == 1 && !c.value) {
        return c.path[0]
      }
    }
  }
  return gone(plan)[0] ?? plan.patterns[0]?.entity ?? 'match'
}

// Every `-comp` a plan names: the components it requires this batch to have
// removed.
let gone = (plan: Match): string[] => {
  let out: string[] = []
  let walk = (cs: Clause[]) => {
    for (let c of cs) {
      if (c.kind == 'gone') out.push(c.comp)
      else if (c.kind == 'and' || c.kind == 'or') walk(c.clauses)
    }
  }
  for (let p of plan.patterns) walk(p.filter.clauses)
  return out
}

// A pattern whose only clause is `-comp`, and the component it names. That is
// already exactly what a removal event reports: the registry's reading of the
// batch knows what each removal took, tombstoned casualties and all
// (./trace.ts), so the slot is registered as that event and triggered by
// `watching` like a creation or a change — no call to `tx.bindings`, no
// overlay, and an external journal's `removed` event still reaches it.
// Anything larger — a removal beside a filter, or joined to another entity —
// is a question only a batch overlay can answer.
let solo = (plan: Match): string | undefined => {
  if (plan.patterns.length != 1) return
  let [p] = plan.patterns
  let [c] = p.filter.clauses
  return p.filter.clauses.length == 1 && c.kind == 'gone' && !p.entity &&
      !p.binds.length && !p.gates.length && !p.ensures.length &&
      !p.writes.length
    ? c.comp
    : undefined
}

/**
 * A registry of post-commit effects, as a plugin:
 *
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 * import { effects } from '@yaks/effects'
 *
 * let fx = effects(vocab)
 * let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
 *
 * fx.created('post', (e) => console.log('a post appeared', e.comp?.title))
 * fx.changed('post', 'published', (e) => notify(e.entity.eid))
 * fx.removed('post', (e) => forget(e.entity.eid))
 * ```
 *
 * It requires the loaded vocabulary because knowing what a cascade will delete
 * — and therefore which components a casualty carried — is a question only a
 * vocabulary can answer. It hooks two phases: `precondition`, where it reads
 * the state the batch is about to change, and `effect`, where it runs the
 * handlers.
 */
export let effects = (vocab: Vocab, opts: Opts = {}): Effects => {
  let slots: Slot[] = []
  let report: Report = (err, run) => {
    try {
      ;(opts.report ?? warn)(err, run)
    } catch (e) {
      console.warn('effect reporting failed —', e)
    }
  }
  let selected = (s: Slot, pass?: Dispatch) =>
    (pass?.want ?? opts.want ?? (() => true))(s.where ?? 'do')
  let reportTo = (pass?: Dispatch): Report =>
    !pass?.report ? report : (err, run) => {
      try {
        pass.report!(err, run)
      } catch (e) {
        console.warn('effect reporting failed —', e)
      }
    }
  let around = opts.around
  let depth = opts.depth ?? 1

  // The write callback as one batch's handlers see it: whatever they write is
  // marked a generation on from the batch that triggered them, so the handler
  // that observes that write knows how far the chain has come.
  let writer = (gen: number): Write => (bundles) => {
    if (!opts.write) {
      throw new Error(
        'this effect asked to write and no write door is registered — ' +
          'effects(vocab, { write: (b) => graph.apply(b, { trusted: true }) })',
      )
    }
    return opts.write(marked(bundles, gen + 1))
  }

  let name = (comp: string, kind: Kind, prop?: string) => {
    let base = prop ? `${comp}.${kind}.${prop}` : `${comp}.${kind}`
    let taken = slots.filter((s) => s.id == base || s.id.startsWith(`${base}#`))
    return taken.length ? `${base}#${taken.length + 1}` : base
  }

  let add = (
    comp: string,
    kind: Kind,
    run: Handler,
    prop?: string,
    policy: Policy = {},
    group?: string,
  ) => {
    slots.push({
      ...policy,
      group,
      id: name(comp, kind, prop),
      comp,
      kind,
      prop,
      run,
    })
    return fx
  }

  // Did this batch touch anything a pattern reads? A pattern is true or false
  // over the whole graph; only a batch that moved one of the components it
  // reads can have changed that, so no other batch runs the query.
  let stirred = (s: Slot, seen: Event[]) =>
    seen.some((e) => s.watch?.includes(e.name))

  // A pattern's bindings, narrowed to this batch. The match is run against
  // storage the ordinary way — a rule's match is a query — and a result row is
  // kept where the batch touched any entity it bound, so a handler runs for
  // what just happened rather than for every row that has matched all along.
  // Any of them, not the first: what makes `$post; .comment about=$post` newly
  // true is usually the comment. Rows a crash left behind are for a boot sweep
  // to find, not for a batch.
  let hits = (
    s: Slot,
    bundles: Bundle[],
    tx: Tx,
  ): Event[] | Promise<Event[]> => {
    let plan = s.plan!
    let touched = new Set<Eid>(bundles.map((b) => b.entity.eid))
    let one = plan.patterns.filter((p) => !p.makes)
    // The batch is passed to the query only where the query is about it: a
    // `-comp` clause reads the deletions a storage's overlay carries, and
    // nothing else here needs a row the committed data does not already
    // have.
    let batch = s.gone?.length ? bundles : []
    if (
      one.length > 1 || plan.patterns.some((p) => p.binds.length) ||
      s.gone?.length
    ) {
      if (!tx.bindings) {
        throw new Error(
          `effect ${s.id} asks about more than one entity, or about what ` +
            'this batch removed, and this storage answers no bindings — a ' +
            'one-entity pattern over committed rows is all it can be asked',
        )
      }
      return then(
        tx.bindings([plan], batch, reads(plan, vocab)),
        ([rows]) =>
          rows
            .filter((r) => r.entities.some((e) => e && touched.has(e)))
            .map((r) => ({
              kind: 'matched' as Kind,
              // The subject: the first entity the match bound. A pattern that
              // only writes binds nothing and its slot is null (@yaks/graph
              // `Binding`), so the event is about the first entity there is.
              entity: { eid: r.entities.find((e) => !!e)! },
              name: s.comp,
              vars: r.vars,
            })),
      )
    }
    return then(
      tx.read(one[0].filter),
      (rows) =>
        rows
          .filter((b) => touched.has(b.entity.eid))
          .map((b) => ({
            kind: 'matched' as Kind,
            entity: b.entity,
            name: s.comp,
            comp: b[s.comp] as Comp | undefined,
          })),
    )
  }

  // A pattern registration. The query is parsed here and narrowed to the
  // components this vocabulary declares (@yaks/graph `asked`), so one pattern
  // is correct in two graphs: a clause about a component this graph cannot
  // store is dropped, and a pattern that requires one is registered and inert
  // — listed, documented, never run.
  let pattern = (
    what: string | Match,
    run: Handler,
    policy: Policy,
    group?: string,
  ) => {
    let written = typeof what == 'string' ? match(what) : what
    let plan = asked(written, vocab)
    // `-comp` alone folds back into the removal event it describes, so
    // `fx.removed('post')` and `fx.on('-post')` are one registration with one
    // id (`post.removed`).
    let one = plan && solo(plan)
    let comp = one ?? about(written)
    let kind: Kind = one ? 'removed' : 'matched'
    slots.push({
      ...policy,
      group,
      id: name(comp, kind),
      comp,
      kind,
      ...(one ? {} : {
        plan: plan ?? undefined,
        watch: plan ? reads(plan, vocab) : [],
        gone: plan ? gone(plan) : [],
      }),
      run,
    })
    return fx
  }

  // One handler run, isolated. Returns whether it completed, which is what a
  // reconciler needs and what dispatch ignores.
  let fire = (
    s: Slot,
    event: Event,
    tx: Tx,
    write: Write,
    reportFailure: Report = report,
  ): boolean | Promise<boolean> => {
    let run: Run = { handler: s.id, event, slot: s }
    let failed = (err: unknown) => {
      reportFailure(err, run)
      return false
    }
    try {
      let go = () => s.run(event, tx, write)
      let out = around ? around(run, tx, go) : go()
      return isPromise(out) ? out.then(() => true, failed) : true
    } catch (err) {
      return failed(err)
    }
  }

  // The effect phase: what happened, who was watching, one isolated run each.
  let dispatch: Hook = (bundles: Bundle[], tx: Tx) => {
    let clean = () => unmark(strip(bundles))
    if (!slots.length) return clean()
    // Past the depth this registry allows: the batch committed, journaled and
    // broadcast to subscribers like any other — it simply triggers no handler,
    // which is where a chain of effects writing about each other stops.
    let gen = generation(bundles)
    if (gen > depth) return clean()
    let write = writer(gen)
    let seen = events(bundles)
    let jobs = seen.flatMap((e) =>
      slots.filter((s) => selected(s) && watching(s, e)).map((s) =>
        [s, e] as [Slot, Event]
      )
    )
    // The patterns this batch could have made true. Run after the
    // created/changed/removed handlers, so an effect that writes about a new
    // component has already written by the time a pattern over that write is
    // run.
    let asking = slots.filter((s) =>
      s.kind == 'matched' && selected(s) && stirred(s, seen)
    )
    if (!jobs.length && !asking.length) return clean()
    let ran = () => over(jobs, ([s, e]) => fire(s, e, tx, write))
    if (!asking.length) return then(ran(), clean)
    return then(
      then(ran(), () =>
        over(asking, (s) => {
          try {
            return then(
              hits(s, bundles, tx),
              (found) => over(found, (e) => fire(s, e, tx, write)),
            )
          } catch (err) {
            // Running the query is the registry's work, not the handler's: a
            // pattern this storage cannot answer is telemetry, never a failed
            // batch (it committed).
            report(err, {
              handler: s.id,
              slot: s,
              event: { kind: 'matched', entity: { eid: '' }, name: s.comp },
            })
            return null
          }
        })),
      clean,
    )
  }

  let fx: Effects = {
    name: opts.name ?? '@yaks/effects',
    // The generation counter an effect's own write carries (write.ts `ORIGIN`)
    // comes back in through `apply()` like any other request, so this plugin
    // declares it.
    requests: [ORIGIN],
    hooks: {
      // Read the state the batch is about to change, while it still stands.
      precondition: (bundles, tx) =>
        slots.length ? before(vocab)(bundles, tx) : bundles,
      effect: dispatch,
    },
    // Nothing is read while no handler is registered, so nothing is asked for.
    wants: (bundles) => [
      ...(slots.length ? wanting(vocab)(bundles) : []),
      ...[...new Set(slots.filter((s) => selected(s)).map((s) => s.wants))]
        .flatMap((wants) => wants?.(bundles) ?? []),
    ],
    created: (comp, run, policy) =>
      add(comp, 'created', run, undefined, policy),
    changed: (comp, prop, run, policy) =>
      typeof prop == 'string'
        ? add(comp, 'changed', run as Handler, prop, policy)
        : add(comp, 'changed', prop, undefined, policy),
    removed: (comp, run, policy = {}) => pattern(`-${comp}`, run, policy),
    slots: () => [...slots],
    owns: (id) => slots.some((s) => s.id == id && selected(s)),
    on: ((
      what: string | Match,
      second: Registration | Handler,
      policy: Policy = {},
    ) => {
      if (typeof second == 'function') return pattern(what, second, policy)
      let { created, changed, removed, ...rest } = second
      let comp = what as string
      let group = `on:${slots.length}`
      if (created) add(comp, 'created', created, undefined, rest, group)
      for (let [prop, run] of Object.entries(changed ?? {})) {
        add(comp, 'changed', run, prop, rest, group)
      }
      if (removed) pattern(`-${comp}`, removed, rest, group)
      return fx
    }) as Effects['on'],
    docs: () => describe(slots),
    dispatch: (events, tx = eventOnly, pass) => {
      let jobs = events.flatMap((e) =>
        slots
          .filter((s) => selected(s, pass) && watching(s, e))
          .map((s) => fire(s, e, tx, writer(0), reportTo(pass)))
      )
      return Promise.all(jobs)
    },
    relay: (rows, tx = eventOnly, pass) => {
      let jobs: Promise<unknown[]>[] = []
      let reportFailure = reportTo(pass)
      for (let s of slots) {
        if (!s.sweep || s.kind != 'created' || !selected(s, pass)) continue
        let failed = (err: unknown): unknown[] => {
          reportFailure(err, {
            handler: s.id,
            slot: s,
            event: {
              kind: 'created',
              entity: { eid: '' },
              name: s.comp,
            },
          })
          return []
        }
        try {
          // Sync readers start handlers now, just like journal dispatch. A
          // remote reader must not hold up another slot's reconciliation.
          let out = then(rows(s.comp, s.sweep.pending), (got) =>
            Promise.all(
              got.map((row) =>
                fire(
                  s,
                  {
                    kind: 'created',
                    entity: { eid: String(row.eid) },
                    name: s.comp,
                    comp: row,
                  },
                  tx,
                  writer(0),
                  reportFailure,
                )
              ),
            ))
          jobs.push(Promise.resolve(out).catch(failed))
        } catch (err) {
          failed(err)
        }
      }
      return Promise.all(jobs).then((out) => out.flat())
    },
    attempt: (id, event, tx) => {
      let s = slots.find((x) => x.id == id)
      if (!s) {
        report(new Error(`no effect registered as ${id}`), {
          handler: id,
          event,
        })
        return false
      }
      if (!selected(s)) return false
      // A reconciled run stands outside any batch, so its own writes start the
      // chain over: what it writes is generation 1, like a first run's.
      return fire(s, event, tx, writer(0))
    },
  }
  return fx
}

// An external journal may have no graph transaction at all. Never return a
// made-up empty result, and never silently permit a write outside apply: every
// method throws.
let noTransaction = (): never => {
  throw new Error('external effect dispatch has no transaction')
}
let eventOnly: Tx = {
  read: noTransaction,
  get: noTransaction,
  patch: noTransaction,
  remove: noTransaction,
}
