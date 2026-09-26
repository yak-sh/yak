// The registry: what a commit owes, what this process watches, and what
// running either means.
//
// Two kinds of registration meet here, and the difference is who knows about
// them.
//
//   An effect is declared in a vocabulary (`effect: true`, @yaks/vocab
//   `effectsIn`), so every process that loads the vocabulary knows what a
//   write owes, whatever it imported. The code that runs one is registered
//   under its name, by a process that runs effects (`handle`). Where the
//   vocabulary declares the `effect` component, a commit writes each run it
//   owes into the graph in its own transaction, and any process working the
//   pool claims it and runs it (./pool.ts). Where it does not, there is no
//   pool to hand one to, and a handled effect runs here after the commit.
//
//   An observer is registered at runtime (`created`, `changed`, `removed`,
//   `on`), so only the process that registered it knows it: it runs in that
//   process, after that process's own commits, at most once. A view refreshing
//   what it shows is an observer.
//
// Both are slots — a component name, one of the things that can happen to it,
// and (for a change) the properties that have to have moved — or a pattern, a
// query run wherever the batch just made it true. `-comp` (@yaks/query) means
// a batch removed a component, so `removed('post')` is `on('-post')`, and a
// pattern with no other clause folds back into the removal event it describes
// (`solo` below): an event already reports exactly that, cascaded casualties
// included.
//
// Two rules hold, and they are the reason effects are a separate phase:
//
//   Post-commit only. A run is written in the transaction that owes it and
//   started once that transaction commits, and an observer runs after it; what
//   they read is settled and nothing they do can reject the write. A batch
//   that was refused owes nothing.
//
//   Isolated. Every handler runs inside its own try — a throw, or a rejected
//   promise, is passed to `report` and the next handler still runs.
//
// A handler that writes is handed the write callback (./write.ts), which puts
// its bundles through the graph's own `apply()` as a new batch. The loop that
// invites is stopped by the generation number that callback sets and this file
// reads, never by a rule each handler has to remember.

import type {
  Bundle,
  Comp,
  Eid,
  Graph,
  Hook,
  Match,
  Plugin,
  Tx,
} from '@yaks/graph'
import { asked, each, isPromise, match, over, reads, then } from '@yaks/graph'
import { type Clause, eq, list } from '@yaks/query'
import { type EffectDecl, effectsIn, type Vocab } from '@yaks/vocab'
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
  type Policy,
  type Registration,
} from './registration.ts'
import { EFFECT, type Owed, pool, type PoolOpts } from './pool.ts'
export type { Description, Policy, Registration } from './registration.ts'

/** A post-commit handler: what happened, a detached transaction to read
 * through, and the callback to write through ({@link Write}). Its return value
 * is awaited when it is a promise. */
export type Handler = (event: Event, tx: Tx, write: Write) => unknown

/** The code for declared effects, by the name each is declared under. */
export type Handlers = Record<string, Handler>

/** One registration: the component it watches, what has to happen to it, and
 * what runs. A declared effect with several triggers is several slots under
 * one name. */
export type Slot = Policy & {
  /** a declared effect's name, or an observer's `post.created`,
   * `post.changed.published`, `post.removed` (with `#2` for a second one) */
  id: string
  /** Related observers registered in one on() call. */
  group?: string
  /** the component name it watches */
  comp: string
  /** what has to happen to that component */
  kind: Kind
  /** for a `changed` slot, the properties one of which has to have moved;
   * absent means any */
  props?: string[]
  /** a `matched` slot's pattern: the parsed query it was registered with */
  plan?: Match
  /** the components that pattern reads — a batch that moved none of them
   * cannot have changed whether it holds, so it is not asked */
  watch?: string[]
  /** `-comp` — the components the pattern requires this batch to have
   * removed, answered through `tx.bindings` with the batch passed in */
  gone?: string[]
  /** the declaration, for a declared effect */
  effect?: EffectDecl
  /** the code: always for an observer, once handled for an effect */
  run?: Handler
}

/** One handler run, for a {@link Report}. */
export type Job = {
  /** the slot's id */
  handler: string
  /** the committed change it is running for */
  event: Event
  /** the registration itself, where there is one */
  slot?: Slot
}

/** Where a failing handler goes. A report is telemetry: it is called instead
 * of the error being thrown, and must not throw itself. */
export type Report = (err: unknown, ctx: Job) => void

/** How a registry is built. */
export type Opts = Partial<PoolOpts> & {
  /** where a failing handler is reported (default: `console.warn`) */
  report?: Report
  /** the plugin's name, for diagnostics (default: `@yaks/effects`) */
  name?: string
  /** how a handler writes back: one new batch through the graph's own
   * `apply()`, trusted (see {@link Write}). Without it a handler that tries to
   * write is reported rather than quietly writing past the pipeline. */
  write?: Write
  /** called after a commit that wrote runs down and claimed none of them
   * here: how a thread working the pool beside this one is told to look now,
   * rather than at its next pass */
  nudge?: () => void
  /** how many generations of effect-written batches still owe runs (default:
   * `1`). A batch from a client is generation 0 and an effect's own write is
   * 1, so the default lets one effect see another's write and stops the
   * generation after that. */
  depth?: number
}

/**
 * A registry: a {@link https://jsr.io/@yaks/graph | @yaks/graph} plugin, plus
 * the methods that register on it. Registration is chainable and may happen
 * at any time — before the graph is built, or after, which is how a handler
 * closes over the graph it writes back through.
 */
export type Effects = Plugin & {
  /** observe an entity gaining this component */
  created: (comp: string, run: Handler, policy?: Policy) => Effects
  /** observe this component being patched — for one property, or for any */
  changed: (
    comp: string,
    prop: string | Handler,
    run?: Handler,
    policy?: Policy,
  ) => Effects
  /** observe this component going, by its own deletion or with its entity */
  removed: (comp: string, run: Handler, policy?: Policy) => Effects
  /**
   * Observe. Two forms, because there are two questions:
   *
   *   fx.on('post', { created, changed: { published }, removed })
   *   fx.on('$call .call, !results', (e) => run(e.entity.eid))
   *
   * The first names a component and what has to happen to it; the second is a
   * pattern — any query, any number of entities — and it runs wherever the
   * batch just made it true.
   */
  on: {
    (comp: string, registration: Registration): Effects
    (pattern: string | Match, run: Handler, policy?: Policy): Effects
  }
  /** the code for declared effects, by name. A name the vocabulary does not
   * declare is an error, so a typo never goes quietly unrun. */
  handle: (handlers: Handlers) => Effects
  /** every registration, declared ones first */
  slots: () => Slot[]
  /** Documentation derived from the registered slots. */
  docs: () => Description[]
  /** Work the pool: claim what is owed and run it (./pool.ts). A live signal
   * keeps working until it aborts; an aborted one is one pass, taken only
   * where no process that stays up is working the pool. Does nothing where
   * the vocabulary keeps no `effect` rows. */
  work: (g: Graph, signal?: AbortSignal) => Promise<void>
  /** Look at the pool again now, rather than at the next pass. */
  wake: () => void
  /** Settles once every run this process started has, and a worker whose
   * signal aborted has stopped. */
  idle: () => Promise<void>
  /** Leave the pool: claim nothing more, so what this process commits from now
   * on is left for the others, and settle what it started. What a process
   * does on its way out. */
  stop: () => Promise<void>
}

let warn: Report = (err, { handler }) =>
  console.warn(`effect ${handler} failed —`, err)

// Whether a slot is watching for this event. A pattern slot watches no single
// event: its query is run against the graph instead (see `hits`).
let watching = (s: Slot, e: Event): boolean =>
  s.kind != 'matched' && s.comp == e.name && s.kind == e.kind &&
  (s.kind != 'changed' || !s.props ||
    (!!e.comp && s.props.some((p) => p in e.comp!)))

// What a pattern is about, in one component name: the first component it
// requires. It names an observer's slot and rides on the event.
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

// A pattern whose only clause is `-comp`, and the component it names — which
// is exactly what a removal event already reports, so it is registered as
// that event. Anything larger is a question only a batch overlay can answer.
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
 * A registry of post-commit effects and observers, as a plugin:
 *
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { loadVocab } from '@yaks/vocab'
 * import { ram } from '@yaks/ram'
 * import { effects } from '@yaks/effects'
 *
 * let title = { type: 'string' }
 * let vocab = loadVocab([{
 *   $defs: {
 *     post: { component: true, properties: { title } },
 *     send_receipt: { effect: true, created: ['post'] },
 *   },
 * }])
 * let fx = effects(vocab)
 * let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
 *
 * fx.handle({ send_receipt: (e) => console.log('mail', e.entity.eid) })
 * fx.created('post', (e) => console.log('a post appeared', e.comp?.title))
 * g.apply([{ entity: { eid: 'p1' }, post: { title: 'Hello' } }])
 * ```
 *
 * It requires the loaded vocabulary: the effects it declares are what a commit
 * owes, and knowing what a cascade will delete — and therefore which
 * components a casualty carried — is a question only a vocabulary can answer.
 */
export let effects = (vocab: Vocab, opts: Opts = {}): Effects => {
  let slots: Slot[] = []
  let report: Report = (err, job) => {
    try {
      ;(opts.report ?? warn)(err, job)
    } catch (e) {
      console.warn('effect reporting failed —', e)
    }
  }
  let depth = opts.depth ?? 1

  // The write callback as one run sees it: whatever it writes is marked a
  // generation on from the batch that owed it.
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

  // A pattern, parsed here and narrowed to the components this vocabulary
  // declares (@yaks/graph `asked`), so one pattern is correct in two graphs:
  // one that requires a component this graph cannot store is registered and
  // inert — listed, documented, never run.
  let planned = (what: string | Match) => {
    let written = typeof what == 'string' ? match(what) : what
    let plan = asked(written, vocab)
    let one = plan && solo(plan)
    return one ? { comp: one, kind: 'removed' as Kind } : {
      comp: about(written),
      kind: 'matched' as Kind,
      plan: plan ?? undefined,
      watch: plan ? reads(plan, vocab) : [],
      gone: plan ? gone(plan) : [],
    }
  }

  // The declared effects, one slot per trigger, all under the effect's name.
  for (let effect of effectsIn(vocab.docs)) {
    let at = (s: Omit<Slot, 'id' | 'effect'>) =>
      slots.push({ ...s, id: effect.name, effect, doc: effect.description })
    for (let comp of effect.created ?? []) at({ comp, kind: 'created' })
    let changed = new Map<string, string[] | undefined>()
    for (let said of effect.changed ?? []) {
      let [comp, prop] = said.split('.')
      let props = changed.has(comp) ? changed.get(comp) : []
      changed.set(comp, prop && props ? [...props, prop] : undefined)
    }
    for (let [comp, props] of changed) at({ comp, kind: 'changed', props })
    for (let comp of effect.removed ?? []) at({ comp, kind: 'removed' })
    if (effect.match) at(planned(effect.match))
    if (effect.sweep && !effect.created) {
      throw new Error(
        `effect ${effect.name} declares a sweep and no created trigger — ` +
          'a sweep owes the created run of what it selects',
      )
    }
  }

  let observe = (s: Omit<Slot, 'id'>, id: string) => {
    slots.push({ ...s, id })
    return fx
  }
  let add = (
    comp: string,
    kind: Kind,
    run: Handler,
    prop?: string,
    policy: Policy = {},
    group?: string,
  ) =>
    observe(
      { ...policy, group, comp, kind, props: prop ? [prop] : undefined, run },
      name(comp, kind, prop),
    )
  let pattern = (
    what: string | Match,
    run: Handler,
    policy: Policy,
    group?: string,
  ) => {
    let s = planned(what)
    return observe({ ...policy, group, ...s, run }, name(s.comp, s.kind))
  }

  // Did this batch touch anything a pattern reads?
  let stirred = (s: Slot, seen: Event[]) =>
    seen.some((e) => s.watch?.includes(e.name))

  // A pattern's bindings, narrowed to this batch: a result row is kept where
  // the batch touched any entity it bound, so a run is owed for what just
  // happened rather than for every row that has matched all along.
  let hits = (
    s: Slot,
    bundles: Bundle[],
    tx: Tx,
  ): Event[] | Promise<Event[]> => {
    let plan = s.plan!
    let touched = new Set<Eid>(bundles.map((b) => b.entity.eid))
    let one = plan.patterns.filter((p) => !p.makes)
    // The batch is passed to the query only where the query is about it: a
    // `-comp` clause reads the deletions a storage's overlay carries.
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
              // The subject: the first entity the match bound.
              entity: { eid: r.entities.find((e) => !!e)! },
              name: s.comp,
              vars: r.vars,
            })),
      )
    }
    // Asked about the entities this batch touched and no others: an index
    // lookup, not a scan with the batch picked out afterwards.
    let { filter } = one[0]
    let about = eq('eid', list(...touched))
    return then(
      tx.read({ ...filter, clauses: [...filter.clauses, about] }),
      (rows) =>
        rows.map((b) => ({
          kind: 'matched' as Kind,
          entity: b.entity,
          name: s.comp,
          comp: b[s.comp] as Comp | undefined,
        })),
    )
  }

  // What this batch did for the slots `which` selects: one pair per slot and
  // event, the created/changed/removed ones first, then the patterns. A
  // pattern this storage cannot answer is reported, never a failed batch.
  let matched = (
    bundles: Bundle[],
    tx: Tx,
    which: (s: Slot) => boolean,
  ): [Slot, Event][] | Promise<[Slot, Event][]> => {
    let chosen = slots.filter(which)
    if (!chosen.length) return []
    let seen = events(bundles)
    let found = seen.flatMap((e) =>
      chosen.filter((s) => watching(s, e)).map((s) => [s, e] as [Slot, Event])
    )
    let asking = chosen.filter((s) =>
      s.kind == 'matched' && s.plan && stirred(s, seen)
    )
    return each(asking, found, (out, s) => {
      try {
        return then(
          hits(s, bundles, tx),
          (evs) => [...out, ...evs.map((e) => [s, e] as [Slot, Event])],
        )
      } catch (err) {
        report(err, {
          handler: s.id,
          slot: s,
          event: { kind: 'matched', entity: { eid: '' }, name: s.comp },
        })
        return out
      }
    })
  }

  // One observer run, isolated.
  let fire = (s: Slot, event: Event, tx: Tx, write: Write): unknown => {
    let failed = (err: unknown) =>
      report(err, { handler: s.id, event, slot: s })
    try {
      let out = s.run!(event, tx, write)
      return isPromise(out) ? out.then(() => null, failed) : null
    } catch (err) {
      return failed(err)
    }
  }

  // The pool, where this vocabulary keeps effect rows.
  let pooled = vocab.comp(EFFECT)
    ? pool({ slots: () => slots, writer, report }, opts)
    : undefined

  // What this process runs itself after a commit: every observer, and a
  // handled effect where there is no pool to hand it to.
  let here = (s: Slot) => !!s.run && (!s.effect || !pooled)

  // The runs a batch's own process claimed, from the transaction that owed
  // them to the phase that starts them, keyed by the batch's first bundle —
  // the same object in both phases.
  let owed = new WeakMap<Bundle, Owed[]>()
  // The batches that wrote runs down and left some for another to claim.
  let left = new WeakSet<Bundle>()

  // Inside the transaction: the runs this batch owes, written down.
  let owe: Hook = (bundles, tx) => {
    if (generation(bundles) > depth) return bundles
    return then(
      matched(bundles, tx, (s) => !!s.effect),
      (found) =>
        !found.length ? bundles : then(
          pooled!.owe(tx, found, generation(bundles)),
          (mine) => {
            if (mine.length) owed.set(bundles[0], mine)
            if (mine.length < found.length) left.add(bundles[0])
            return bundles
          },
        ),
    )
  }

  // After the commit: the runs this process claimed as it wrote them are
  // started, and every observer runs.
  let after: Hook = (bundles, tx) => {
    let mine = bundles[0] && owed.get(bundles[0])
    let clean = () => unmark(strip(bundles))
    if (mine) {
      owed.delete(bundles[0])
      pooled!.start(mine)
    }
    if (bundles[0] && left.delete(bundles[0])) opts.nudge?.()
    let gen = generation(bundles)
    if (gen > depth || !slots.some(here)) return clean()
    let write = writer(gen)
    return then(
      then(
        matched(bundles, tx, here),
        (found) => over(found, ([s, e]) => fire(s, e, tx, write)),
      ),
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
      ...(pooled ? { commit: owe } : {}),
      effect: after,
    },
    // Nothing is read while nothing is registered, so nothing is asked for.
    wants: (bundles) => [
      ...(slots.length ? wanting(vocab)(bundles) : []),
      ...[...new Set(slots.map((s) => s.wants))]
        .flatMap((wants) => wants?.(bundles) ?? []),
    ],
    created: (comp, run, policy) =>
      add(comp, 'created', run, undefined, policy),
    changed: (comp, prop, run, policy) =>
      typeof prop == 'string'
        ? add(comp, 'changed', run as Handler, prop, policy)
        : add(comp, 'changed', prop, undefined, policy),
    removed: (comp, run, policy = {}) => pattern(`-${comp}`, run, policy),
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
    handle: (handlers) => {
      for (let [id, run] of Object.entries(handlers)) {
        let mine = slots.filter((s) => s.effect && s.id == id)
        if (!mine.length) throw new Error(`no effect is declared as ${id}`)
        for (let s of mine) s.run = run
      }
      return fx
    },
    slots: () => [...slots],
    docs: () => describe(slots),
    work: (g, signal) => pooled?.work(g, signal) ?? Promise.resolve(),
    wake: () => pooled?.wake(),
    idle: () => pooled?.idle() ?? Promise.resolve(),
    stop: () => pooled?.stop() ?? Promise.resolve(),
  }
  return fx
}
