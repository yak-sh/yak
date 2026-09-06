// The registry: who is watching, and what running them means.
//
// A registration is a SLOT — a component name, one of the three things that
// can happen to it, and (for a change) the column that has to have moved.
// Handlers are matched by slot rather than by a filter function, so what a
// graph will do about a write can be listed, and so a handler that watches one
// column is never woken by a batch that moved a different one.
//
// Two rules hold, and they are the reason effects are a separate phase:
//
//   POST-COMMIT ONLY. Handlers run after the transaction returned, so what
//   they read is settled and nothing they do can veto the write. A batch that
//   was refused never reaches this phase at all.
//
//   ISOLATED. Every handler runs inside its own try — a throw, or a rejected
//   promise, goes to `report` and the next handler still runs. An observer
//   that breaks must not break the thing it was watching, and the write is
//   already durable by then anyway.
//
// A handler that returns a promise is awaited, which is @yaks/graph's sync
// pass-through working as designed: a graph whose effects are all synchronous
// keeps a synchronous `apply()`, and the first asynchronous handler makes that
// one call's answer a promise. A handler that must not delay its caller starts
// its own work and returns nothing.
//
// A handler that WRITES is handed a third thing: the write door (./write.ts),
// which puts its bundles through the graph's own `apply()` as a new batch. The
// loop that invites is stopped by the generation the door marks and this file
// reads — never by a rule each handler has to remember.

import type { Bundle, Hook, Plugin, Tx } from '@yaks/graph'
import { isPromise, over, then } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import {
  before,
  type Event,
  events,
  type Kind,
  strip,
  wanting,
} from './trace.ts'
import { generation, marked, unmark, type Write } from './write.ts'

/** A post-commit observer: what happened, a detached transaction to read
 * through, and the door to WRITE through ({@link Write}). Its return value is
 * awaited when it is a promise. */
export type Handler = (event: Event, tx: Tx, write: Write) => unknown

/** One registration: the component it watches, what has to happen to it, and
 * the handler. `id` names it — `post.created`, `post.changed.published`,
 * `post.removed`, with `#2` appended when a slot is taken twice. */
export type Slot = {
  /** the registration's name, unique within one registry */
  id: string
  /** the component name it watches */
  comp: string
  /** what has to happen to that component */
  kind: Kind
  /** the column that has to have moved, for a `changed` slot that names one */
  column?: string
  /** the handler itself */
  run: Handler
}

/** One handler about to run, for a {@link Report} or an {@link Around}. */
export type Job = {
  /** the slot's id */
  handler: string
  /** the committed change it is running for */
  event: Event
}

/** Where a failing handler goes. A report is telemetry: it is called instead
 * of the error being thrown, and must not throw itself. */
export type Report = (err: unknown, ctx: Job) => void

/**
 * A wrapper around every handler run: `next()` runs the handler, and whatever
 * this returns is what the dispatch awaits. The durability tier is one of
 * these ({@link https://jsr.io/@yaks/effects/doc/~/ledger | ledger}); so is a
 * timer, a log line, or a queue.
 */
export type Around = (job: Job, tx: Tx, next: () => unknown) => unknown

/** How a registry is built. */
export type Opts = {
  /** where a failing handler is reported (default: `console.warn`) */
  report?: Report
  /** a wrapper around every handler run — durability, timing, logging */
  around?: Around
  /** the plugin's name, for diagnostics (default: `@yaks/effects`) */
  name?: string
  /** how a handler writes back: one new batch through the graph's own
   * `apply()`, trusted (see {@link Write}). Without it a handler that asks to
   * write is reported rather than quietly writing past the pipeline. */
  write?: Write
  /** how many generations of effect-written batches still wake handlers
   * (default: `1`). A batch at a door is generation 0 and an effect's own
   * write is 1, so the default lets one effect see another's write and stops
   * the generation after that. */
  depth?: number
}

/**
 * A registry: a {@link https://jsr.io/@yaks/graph | @yaks/graph} plugin, plus
 * the three ways to register a handler on it. Registration is chainable and
 * may happen at any time — before the graph is built, or after, which is how a
 * handler closes over the graph it writes back through.
 */
export type Effects = Plugin & {
  /** run when an entity gains this component */
  created: (comp: string, run: Handler) => Effects
  /** run when this component is patched — for one column, or for any */
  changed: (comp: string, column: string | Handler, run?: Handler) => Effects
  /** run when this component goes, by its own deletion or with its entity */
  removed: (comp: string, run: Handler) => Effects
  /** every registration, in the order they were made */
  slots: () => Slot[]
  /** run one registration by id, isolated: `true` if it completed, `false` if
   * it failed and was reported. The door a reconciler re-runs through. */
  attempt: (id: string, event: Event, tx: Tx) => boolean | Promise<boolean>
}

let warn: Report = (err, { handler }) =>
  console.warn(`effect ${handler} failed —`, err)

// Whether a slot is watching for this event.
let watching = (s: Slot, e: Event): boolean =>
  s.comp == e.name && s.kind == e.kind &&
  (s.kind != 'changed' || !s.column || (!!e.comp && s.column in e.comp))

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
 * It takes the loaded vocabulary because knowing what a cascade will kill —
 * and therefore what a casualty carried — is a question only a vocabulary can
 * answer. It hooks two phases: `precondition`, where it reads the state the
 * batch is about to change, and `effect`, where it runs the handlers.
 */
export let effects = (vocab: Vocab, opts: Opts = {}): Effects => {
  let slots: Slot[] = []
  let report = opts.report ?? warn
  let around = opts.around
  let depth = opts.depth ?? 1

  // The write door as one batch's handlers see it: whatever they write is
  // marked a generation on from the batch that woke them, so the run that
  // observes THAT write knows how far the chain has come.
  let writer = (gen: number): Write => (bundles) => {
    if (!opts.write) {
      throw new Error(
        'this effect asked to write and no write door is registered — ' +
          'effects(vocab, { write: (b) => graph.apply(b, { trusted: true }) })',
      )
    }
    return opts.write(marked(bundles, gen + 1))
  }

  let name = (comp: string, kind: Kind, column?: string) => {
    let base = column ? `${comp}.${kind}.${column}` : `${comp}.${kind}`
    let taken = slots.filter((s) => s.id == base || s.id.startsWith(`${base}#`))
    return taken.length ? `${base}#${taken.length + 1}` : base
  }

  let add = (comp: string, kind: Kind, run: Handler, column?: string) => {
    slots.push({ id: name(comp, kind, column), comp, kind, column, run })
    return fx
  }

  // One handler run, isolated. `ok` says whether it completed, which is what a
  // reconciler needs and what dispatch ignores.
  let fire = (
    s: Slot,
    event: Event,
    tx: Tx,
    write: Write,
  ): boolean | Promise<boolean> => {
    let job: Job = { handler: s.id, event }
    let failed = (err: unknown) => {
      report(err, job)
      return false
    }
    try {
      let go = () => s.run(event, tx, write)
      let out = around ? around(job, tx, go) : go()
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
    // cast to subscribers like any other — it simply wakes nobody, which is
    // where a chain of effects writing about each other comes to rest.
    let gen = generation(bundles)
    if (gen > depth) return clean()
    let write = writer(gen)
    let jobs = events(bundles).flatMap((e) =>
      slots.filter((s) => watching(s, e)).map((s) => [s, e] as [Slot, Event])
    )
    if (!jobs.length) return clean()
    return then(over(jobs, ([s, e]) => fire(s, e, tx, write)), clean)
  }

  let fx: Effects = {
    name: opts.name ?? '@yaks/effects',
    hooks: {
      // Read the state the batch is about to change, while it still stands.
      precondition: (bundles, tx) =>
        slots.length ? before(vocab)(bundles, tx) : bundles,
      effect: dispatch,
    },
    // Nothing is read while no handler is registered, so nothing is asked for.
    wants: (bundles) => slots.length ? wanting(vocab)(bundles) : [],
    created: (comp, run) => add(comp, 'created', run),
    changed: (comp, column, run) =>
      typeof column == 'string'
        ? add(comp, 'changed', run as Handler, column)
        : add(comp, 'changed', column),
    removed: (comp, run) => add(comp, 'removed', run),
    slots: () => [...slots],
    attempt: (id, event, tx) => {
      let s = slots.find((x) => x.id == id)
      if (!s) {
        report(new Error(`no effect registered as ${id}`), {
          handler: id,
          event,
        })
        return false
      }
      // A reconciled run stands outside any batch, so its own writes start the
      // chain over: what it writes is generation 1, like a fresh run's.
      return fire(s, event, tx, writer(0))
    },
  }
  return fx
}
