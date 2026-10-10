// A graph: a vocabulary, a storage adapter, and the plugins that extend what
// `apply()` does. This file is the assembly — the phase list, the core's own
// work at each phase, and the transaction the middle of the list runs inside.
//
// Everything here is per instance. There is no module-global registry of
// plugins, effects or hooks: two graphs in one process (a page's local graph
// and its mirror of the server's, or a test fixture beside a live store) share
// nothing, and a plugin registered on one is invisible to the other.
//
// One run, in order:
//
//   normalize   core     every id the batch names, as the eid it names
//               hooks    pure, before the transaction opens
//   admit       core     refuse undeclared components and properties, drop the
//                        server-owned ones, check the values
//   mint        core     assign an id to every $alias, and rewrite the
//                        references to it
//   prepare     hooks    idempotent external work before taking the write lock
//   ───────────────────  the transaction opens
//   gather      core     every read this batch is going to need, in one call
//   precondition core    the `$was` check   (a lease check is a hook here)
//   rules       rules    the declarative half, over the batch as an overlay
//   mutate      core     the patches are written
//   cascade     core     deletions spread; the entities they take join the
//                        batch
//   stamp       core     created / updated
//   journal     hooks    the record of what happened
//   commit      hooks    the last chance to act inside the transaction
//   ───────────────────  the transaction commits (or rolls back on a throw)
//   effect      rules/hooks post-commit observers, each isolated
//   audit       hooks    after a rollback, with the error that caused it
//
// `apply()` returns the batch as applied plus everything it generated —
// entities the cascade deleted, entities created with their assigned number,
// stamps — so a client that applies the return value to its cache ends up
// exactly where the graph is. It returns one bundle per entity
// (./compose.ts): each phase adds its own patch, and composing them is the
// last thing this file does, so no caller has to merge three bundles to see
// the one entity it just wrote. The `$` keys belong to the write pipeline and
// are stripped there; the uncomposed phase output is what every hook sees
// inside the pipeline, and what a dry run's {@link Checked} carries.
//
// `check: true` runs that whole list and then refuses the commit, so a caller
// spreading one batch over several graphs can ask them all "would you accept
// this?" before any of them keeps it. That rollback is a rollback like any
// other — the audit hooks see it, carrying a `Checked` error — so a hook that
// wrote inside the transaction is never left believing its rows are still
// there.

import { rulesIn, syncOf, type Vocab } from '@yaks/vocab'
import {
  type Context,
  context,
  during,
  live,
  parent,
  peek,
  recording,
  scope,
} from '@yaks/trace'
import { after, each, isPromise } from '@yaks/fp'
import {
  type Actor,
  type Bundle,
  type Comp,
  comps,
  dead,
  type Eid,
  gives,
} from './bundle.ts'
import type { ReadTx, Row, Storage, Tx } from './storage.ts'
import { detached, type Query, type ReadOpts } from './storage.ts'
import type {
  Hook,
  Phase,
  Plugin,
  ReadView,
  Tracker,
  WriteHook,
} from './plugin.ts'
import { type Derive, isAlias, resolve, substitute } from './alias.ts'
import { identified, identities } from './identity.ts'
import { mint as fresh } from './mint.ts'
import { admit, formed, known, Refused } from './admit.ts'
import { requested } from './request.ts'
import { composed } from './compose.ts'
import {
  type Ask,
  complete,
  gather,
  holding,
  merged,
  reached,
} from './gather.ts'
import { guard } from './guard.ts'
import { mutate, rejoin } from './mutate.ts'
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
import {
  fire,
  observes,
  registry,
  type Resource,
  type Rule,
  stands,
} from './rules.ts'
import { own, type Ready, ready, settle } from './declared.ts'
import { state } from './state.ts'
import { reader as reading } from './read.ts'
import { NeedsWrite, rehearsing } from './admission.ts'
import { referenced } from './tool.ts'

/** Checking options. `overlay` is the host's already admitted, canonical
 * component values, used to check a partial patch's complete proposed value.
 * Only peer components enter the current-value view; committed ownership
 * stays in place, and `$was` checks committed state before the overlay. */
export type AdmitOpts = ApplyOpts & { overlay?: Bundle[] }

let overlaid = (
  bundles: Bundle[],
  vocab: Vocab,
  overlay: Bundle[] = [],
): Bundle[] => {
  if (!overlay.length) return bundles
  let at = new Map(composed(overlay).map((b) => [b.entity.eid, b]))
  return bundles.map((b) => {
    let prior = at.get(b.entity.eid)
    if (!prior) return b
    let out = { ...b }
    for (let [name, patch] of comps(b)) {
      if (patch == null || syncOf(vocab, name) != 'peers') continue
      out[name] = { ...prior[name] as Record<string, unknown>, ...patch }
    }
    return out
  })
}

/** The options one `apply()` call can pass. */
export type ApplyOpts = {
  /** A runtime activity on this graph, not an entity ID or persisted field. */
  parent?: string
  /** the caller is trusted server code: server-owned properties are accepted */
  trusted?: boolean
  /** Whether core provenance and mark rules run (default: true). Trusted
   * server code may pass false to correct stored metadata without replacing
   * existing provenance. Plugin rules and hooks, validation, journaling and effects
   * still run. Refused unless `trusted` is true. */
  stamp?: boolean
  /** the batch copies rows another graph already admitted into this graph's
   * copy of them — a replica landing what its server sent. A copy holds only
   * the words it was loaded with, so a component this vocabulary does not
   * declare is left out; every other write is refused for naming one. It
   * holds the values its server computed as the server sent them, since it
   * has no rule to derive them itself. With `trusted: true`, write admission
   * is skipped: stored values are kept without validation or ref resolution.
   * `trusted` alone still admits a new write strictly. */
  replica?: boolean
  /** the timestamp every stamp in this batch uses, ISO-8601 (default: now) */
  now?: string
  /** a dry run: every phase runs and the transaction is rolled back instead of
   * committed, so nothing is written and no effect observes it. The return
   * value is the batch the phases produced, composed like any other — a
   * refusal still throws, which is the whole point of asking. The audit hooks
   * see the rollback (see {@link Checked}). */
  check?: boolean
  /** Hold observers until an enclosing transaction commits. */
  deferEffects?: (run: () => void | Promise<void>) => void
}

/** Data options for a write, also usable across a thread boundary.
 * Deferred effects belong to a local graph. */
export type WriteOpts = Omit<ApplyOpts, 'deferEffects'>

/**
 * How a dry run leaves a transaction that has done all its work. The phases
 * have run; the only thing left is the commit, which is exactly what a check
 * must not do — so the transaction body throws this, the adapter rolls back,
 * and `apply()` catches it and returns the batch instead.
 *
 * It reaches the `audit` hooks, which is the whole reason it is an exported
 * class a hook can check for: a hook that wrote inside the transaction — or
 * that recorded somewhere that it had written — must be told the rows are
 * gone, and `audit` is where that is reported. A hook that records refusals
 * should ignore it: nothing was refused, and a dry run is not an incident.
 */
export class Checked extends Error {
  /** the batch as the phases produced it, uncomposed — one patch per phase,
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
  /** whose graph this is: the actor used to sign a batch that names none.
   * The program's own writes — its rules, its effects, the pass it makes at
   * startup, a bulk import — arrive with nothing to attribute them to, and are
   * stored attributed to this actor rather than to nobody. An HTTP or MCP
   * server that authenticated somebody overrides this before the batch ever
   * reaches `apply()` (`signed`). */
  actor?: Actor
  /** Per-entity provenance policy; the core keeps the stamp mechanism. */
  provenance?: StampPolicy
  /** the calling program's provenance clock, sampled once when a rule first
   * asks for #Now. `ApplyOpts.now` takes precedence. The default is still the
   * time the apply started. */
  clock?: () => string
  /** a calling program with an enclosing transaction of its own may queue
   * observers until that transaction commits. Discard the queue on rollback.
   * Deferred observers do not change what this apply returns; any writes they
   * make are separate operations. */
  deferEffects?: (run: () => void | Promise<void>) => void
  /** where a failing effect is reported (default: `console.error`) */
  report?: (err: unknown, at: { phase: Phase; plugin: string }) => void
  /** how to generate an id for an entity written under an alias, when no
   * component derives its own id (default: `mint()` from the id package) */
  mint?: () => Eid
  /** how a refusal of a component this vocabulary does not declare ends: where
   * a caller's own word would come from, for a graph whose callers declare
   * words of their own (default: that nothing this vocabulary was loaded from
   * declares it; @yaks/vocab `unknownComps`) */
  teach?: string
  /** which declared rules run on a batch (default: every one but a page's
   * own, ./declared.ts `own`). A page decides for itself, since it holds only
   * part of the graph (@yaks/client). */
  runs?: (rule: Ready, o: ApplyOpts) => boolean
}

/** A live graph: what it knows, and what you can do with it. */
export type Graph = {
  /** the component vocabulary this graph uses */
  vocab: Vocab
  /** Whether a value of this property means its entity wears the
   * component (its storage's `worn`; no by default). */
  worn: (comp: string, prop: string) => boolean
  /** the adapter that stores the data */
  storage: Storage
  /** Detached reads of committed state, with whole component bundles and
   * binding queries, as post-commit handlers receive. */
  outside: ReadTx
  /** the plugins registered on this graph, in order */
  plugins: Plugin[]
  /** register another plugin (its hooks join the ones already there) */
  use: (plugin: Plugin) => Graph
  /** make the storage ready for this graph's vocabulary */
  install: () => void | Promise<void>
  /** Whether this caller needs plugin query or answer rewrites. */
  rewrites: (opts?: ReadOpts) => boolean
  /** Run core addressing and plugin query rewrites; unchanged text stays text. */
  ask: (query: Query, opts?: ReadOpts) => Query | Promise<Query>
  /** Run plugin answer rewrites, also used by subscription transports. */
  answer: (bundles: Bundle[], opts?: ReadOpts) => Bundle[] | Promise<Bundle[]>
  /** A caller view with canonical candidates and its addressed original query,
   * or null when ordinary storage reads answer this caller directly. */
  view: (
    query: Query,
    opts?: ReadOpts,
  ) => ReadView | null | Promise<ReadView | null>
  /** a query → the matching entities, each carrying the components the query
   * names (`*` for every one, ./projection.ts) */
  read: (query: Query, opts?: ReadOpts) => Bundle[] | Promise<Bundle[]>
  /** a query → the compiled statement's raw rows */
  rows: (query: Query, opts?: ReadOpts) => Row[] | Promise<Row[]>
  /** these entities as they stand, by eid: a deleted one comes back carrying
   * `tombstone`, one that does not exist is absent. Each carries the
   * components `comps` names, or every one when it is left out. A lookup, not
   * a search, and it takes no write lock ({@link Storage.get}). */
  get: (
    eids: Eid[],
    comps?: string[],
    opts?: ReadOpts,
  ) => Bundle[] | Promise<Bundle[]>
  /** the ids a caller passed → the eids they refer to, for the ones that are
   * not eids already (see {@link Plugin.address}). Only the ids that changed
   * are in the returned map, so a caller reads it as `at.get(id) ?? id`; with
   * no plugin resolving names, every id is itself and this costs nothing. An
   * id a plugin recognised and found naming nothing is refused. `kind` is the
   * component the ids are meant to name, where the caller knows it (a tool
   * argument declared `ref: 'session'`): a plugin may answer to a key only
   * that kind has, such as a transcript's own id. */
  address: (
    ids: string[],
    kind?: string,
  ) => Map<string, Eid> | Promise<Map<string, Eid>>
  /** apply bundles in one transaction → the bundles as applied, one per
   * entity, plus everything the pipeline generated */
  apply: (bundles: Bundle[], opts?: ApplyOpts) => Bundle[] | Promise<Bundle[]>
  /** Check a value through ordinary write admission without retaining it.
   * Certified plugins check against temporary rows; unsupported policies use
   * the owning adapter's ordinary dry run. Returns composed checked patches,
   * including rule outputs, rewrites and stamps. */
  admit: (bundles: Bundle[], opts?: AdmitOpts) => Bundle[] | Promise<Bundle[]>
}

/** A graph's data interface, whether its storage is local or another thread
 * owns it. Every write uses the owning graph's `apply()` pipeline. */
export type Access =
  & Pick<Graph, 'vocab' | 'read' | 'rows' | 'get' | 'outside'>
  & {
    /** Write data through the owning graph; local controls stay on Graph. */
    apply: (bundles: Bundle[], opts?: WriteOpts) => Bundle[] | Promise<Bundle[]>
  }

// One step of the pipeline: the bundles in, the bundles the next step sees
// out.
type Step = (bundles: Bundle[]) => Bundle[] | Promise<Bundle[]>
type Timing = <T>(
  name: Phase | 'gather' | 'transaction' | 'compose' | 'flush',
  run: () => T | Promise<T>,
  plugin?: string,
) => T | Promise<T>
type Run = {
  admission: boolean
  tracing?: Context
  parent: () => string | undefined
  resources: Record<string, Resource>
  timed: Timing
}

// A moment written out once for each millisecond: formatting a timestamp
// takes longer than most of a write does, and writes come in bursts that
// share their millisecond.
let last = { ms: NaN, iso: '' }
let iso = (ms: number): string =>
  ms === last.ms
    ? last.iso
    : (last = { ms, iso: new Date(ms).toISOString() }).iso

let failed = (err: unknown, at: { phase: Phase; plugin: string }) =>
  console.error(`${at.plugin} failed at ${at.phase} —`, err)

// Each vocabulary's declared rules, read from its documents once.
let declaredRules = new WeakMap<Vocab, ReturnType<typeof rulesIn>>()
let declaredIn = (vocab: Vocab) => {
  let held = declaredRules.get(vocab)
  if (!held) declaredRules.set(vocab, held = rulesIn(vocab.docs))
  return held
}

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

  // What the vocabulary derives for itself: every component declaring an
  // `identity` derives its entity's id from that value (identity.ts). Fixed
  // for the life of this graph, because the vocabulary is.
  let declared = identities(vocab)
  let phaseHooks = new Map<Phase, [string, Hook][]>()
  let phaseRules = new Map<Phase, Rule[]>()
  let declarations: Ready[] = []
  let declarationKey: string | undefined

  // Every content-addressed component's id-deriving function, by component
  // name. Read once per apply, so a plugin registered later is included. A
  // plugin's own `derive` takes precedence: @yaks/edge and @yaks/key derive an
  // entity's id from the relation component it carries, which a list of
  // properties cannot express.
  let derives = (): Record<string, Derive> =>
    plugins.some((p) => p.derive)
      ? Object.assign({}, declared, ...plugins.map((p) => p.derive ?? {}))
      : declared

  // Every read this batch is going to need: the core's own — every entity the
  // batch names or references, which is what the `$was` check, `mutate` and
  // storage's own number assignment all need — plus whatever each plugin
  // declares.
  let asking = (bundles: Bundle[], admission = false): Ask[] => [
    {
      eids: reached(bundles, vocab),
      select: [
        ...new Set(bundles.flatMap((b) => comps(b).map(([name]) => name))),
      ],
    },
    // Provenance can introduce references that the input did not name. Read
    // those identities alongside the batch, rather than one query at stamp.
    // These are hints: unused metadata must never add a refusal.
    ...bundles.some((b) => b.$actor)
      ? [{
        eids: [
          ...new Set(bundles.flatMap((b) =>
            [b.$actor?.by, b.$actor?.via].filter((eid): eid is Eid =>
              typeof eid == 'string'
            )
          )),
        ],
        select: [],
        hint: true,
      }]
      : [],
    ...plugins.flatMap((p) =>
      p.wants?.(bundles, { graph: g, admission }) ?? []
    ),
  ]

  let certified = (bundles: Bundle[]) =>
    !bundles.some(dead) &&
    plugins.every((p) =>
      p.admission ? p.admission(bundles) : !p.track && !p.beforeWrite &&
        ![
          'prepare',
          'precondition',
          'rules',
          'mutate',
          'cascade',
          'stamp',
          'journal',
          'commit',
        ].some((name) => p.hooks?.[name as Phase]) &&
        !p.rules?.some((r) =>
          !['normalize', 'admit', 'mint', 'effect', 'audit'].includes(r.phase)
        )
    )

  // The hooks registered on a phase, in plugin registration order.
  let hooks = (phase: Phase): [string, Hook][] => {
    let found = phaseHooks.get(phase)
    let i = 0
    let same = !!found
    for (let p of plugins) {
      let h = p.hooks?.[phase]
      if (!h) continue
      if (found?.[i]?.[0] !== p.name || found?.[i]?.[1] !== h) same = false
      i++
    }
    if (!same || found!.length != i) {
      found = plugins.flatMap((p) => {
        let h = p.hooks?.[phase]
        return h ? [[p.name, h] as [string, Hook]] : []
      })
      phaseHooks.set(phase, found)
    }
    return found!
  }

  // The rules registered on a phase: the core's own (the stamps), then each
  // plugin's, in registration order.
  // The marks come from the vocabulary, so a program that replaces the
  // created/updated pair with a policy of its own still gets them.
  let stamping = Map.groupBy(
    [...provenance(opts.provenance), ...marks(vocab)],
    (r) => r.phase,
  )
  // Reuse parsed declarations while their contents agree. Registrations are
  // mutable, including nested hooks, rule arrays and declaration properties;
  // check those inputs afresh, never a writer's choices or stored state.
  //
  // Most of them come from the graph's own vocabulary, because that is where
  // an app's `vocab.json` ends up — so an app that ships a `rule: true` entry
  // runs it with no wiring at all. A plugin registered after the graph was
  // built carries documents the loaded vocabulary never saw, so those are read
  // too. The vocabulary's own are read once for every graph over it, since a
  // vocabulary is fixed; the plugins' are checked at every write.
  let loaded = new Set(vocab.docs)
  let declaring = () => {
    let vocabRules = declaredIn(vocab)
    let theirs = plugins.flatMap((p) => [
      ...(p.declared ?? []),
      ...rulesIn((p.vocab ?? []).filter((d) => !loaded.has(d))),
    ])
    let key = JSON.stringify(theirs)
    if (key !== declarationKey) {
      declarations = ready([...vocabRules, ...theirs].map((r) => ({
        ...r,
        ...(r.before ? { before: [...r.before] } : {}),
      })))
      declarationKey = key
    }
    return declarations
  }
  let ruled = (phase: Phase, stamp = true): Rule[] => {
    let found = phaseRules.get(phase)
    let i = 0
    let same = !!found
    for (let p of plugins) {
      for (let r of p.rules ?? []) {
        if (r.phase != phase) continue
        if (found?.[i] !== r) same = false
        i++
      }
    }
    if (!same || found!.length != i) {
      found = plugins.flatMap((p) => p.rules ?? []).filter((r) =>
        r.phase == phase
      )
      phaseRules.set(phase, found)
    }
    let stamps = stamp ? stamping.get(phase) : undefined
    return stamps ? [...stamps, ...found!] : found!
  }

  // The singletons a rule may bind with `#Name`: each plugin's, then this
  // graph's own three, which take precedence — nothing a plugin registers can
  // change the transaction's timestamp or its actor out from under the stamps.
  let resourced = (now: () => string): Record<string, Resource> => ({
    ...plugins.some((p) => p.resources)
      ? registry(plugins.map((p) => p.resources))
      : {},
    Vocab: () => vocab,
    Now: () => stands({ at: now() }),
    // A copy, so a rule cannot mutate the batch's own `$actor`.
    Actor: (tick) => {
      let who = actorOf(tick.bundles)
      return stands({ ...who }, who.by)
    },
  })

  // A batch that names no writer is this graph's own — nobody authenticated
  // it because there was no request: a rule's effect, a startup pass, a bulk
  // import by the process that holds the file. It is attributed to the calling
  // program rather than to nobody, so every write has an author and the
  // journal has a name to record. A server that authenticated somebody
  // overrides this (`signed`) before the batch gets here.
  let owned = (bundles: Bundle[]): Bundle[] =>
    opts.actor && !bundles.some((b) => b.$actor)
      ? signed(bundles, opts.actor)
      : bundles

  // Synchronous phases use plain loops. A continuation is needed only when a
  // core, rule or hook yields; all registrations still come from the moment
  // the phase began, and each hook gets its own context.
  let runHooks = (
    run: Run,
    name: Phase,
    tx: Tx,
    calls: [string, Hook][],
    bundles: Bundle[],
    start = 0,
  ): Bundle[] | Promise<Bundle[]> => {
    for (let i = start; i < calls.length; i++) {
      let [plugin, h] = calls[i]
      let out = run.tracing && live(run.tracing) && peek(g)
        ? run.timed(
          name,
          () =>
            h(bundles, tx, undefined, {
              graph: g,
              parent: run.parent(),
              admission: run.admission,
            }),
          plugin,
        )
        : h(bundles, tx, undefined, { graph: g, admission: run.admission })
      if (isPromise(out)) {
        return out.then((b) => runHooks(run, name, tx, calls, b, i + 1))
      }
      bundles = out
    }
    return bundles
  }
  let runPhase = (
    run: Run,
    name: Phase,
    tx: Tx,
    core: Step | undefined,
    of: ((eid: Eid) => Bundle | undefined) | undefined,
    rules: Rule[],
    calls: [string, Hook][],
    bundles: Bundle[],
  ): Bundle[] | Promise<Bundle[]> => {
    if (core) {
      let out = core(bundles)
      if (isPromise(out)) {
        return out.then((b) =>
          runPhase(run, name, tx, undefined, of, rules, calls, b)
        )
      }
      bundles = out
    }
    if (rules.length) {
      let tracing = run.tracing && live(run.tracing) && peek(g)
        ? { ...run.tracing, parent: run.parent() }
        : undefined
      let out = fire(rules, {
        vocab,
        tx,
        phase: name,
        bundles,
        resources: run.resources,
        of,
        tracing,
        owner: tracing
          ? (r) => plugins.find((p) => p.rules?.includes(r))?.name
          : undefined,
      })
      if (isPromise(out)) {
        return out.then((b) => runHooks(run, name, tx, calls, b))
      }
      bundles = out
    }
    return runHooks(run, name, tx, calls, bundles)
  }

  // Restore an operation's context whenever its retained transaction enters
  // storage. Keep a synchronous rule's deeper span only within this ancestry.
  let tracedTx = (tx: Tx, owner: () => Context): Tx =>
    Object.fromEntries(
      Object.entries(tx).map((
        [name, method],
      ) => [
        name,
        typeof method != 'function' ? method : (...args: unknown[]) => {
          let at = owner()
          let inside = context(at.parent)
          return scope(
            inside?.channel == at.channel && live(at) ? inside : at,
            () => Reflect.apply(method, tx, args),
          )
        },
      ]),
    ) as Tx

  let outsideRead = (): Tx => {
    let tx = detached(storage)
    let at = context()
    return at ? tracedTx(tx, () => at) : tx
  }

  let applying = (
    bundles: Bundle[],
    o: AdmitOpts,
    tracing?: Context,
    admission = false,
    fallback = false,
  ):
    | Bundle[]
    | Promise<
      Bundle[]
    > => {
    if (o.stamp === false && !o.trusted) {
      throw new Refused('only trusted writes may disable stamping')
    }
    let current = tracing?.parent
    let checking = false
    let st = state()
    // When the apply began, written out only once something reads it.
    let began = Date.now()
    let instant: string | undefined
    let moment = () => instant ??= o.now ?? opts.clock?.() ?? iso(began)
    let traced = (tx: Tx): Tx =>
      tracing ? tracedTx(tx, () => ({ ...tracing, parent: current })) : tx
    let outside = traced(detached(storage))
    // One registry for the whole apply, so `#Now` is one instant however many
    // phases and rules read it.
    let resources = resourced(moment)
    let timed: Timing = (name, run, plugin) => {
      let c = tracing && live(tracing) && peek(g)
      if (!c) return run()
      let before = current
      let span = c.begin({
        kind: 'phase',
        name,
        parent: before,
        package: '@yaks/graph',
        plugin,
      })
      current = span?.id ?? before
      let restore = () => {
        current = before
      }
      try {
        let out = during(span, run)
        if (isPromise(out)) {
          return out.then((value) => {
            restore()
            return value
          }, (error) => {
            restore()
            throw error
          })
        }
        restore()
        return out
      } catch (error) {
        restore()
        throw error
      }
    }
    let gathering = (tx: Tx, b: Bundle[]) =>
      timed('gather', () => gather(tx, vocab, asking(b, checking)))
    let run: Run = {
      admission,
      tracing,
      parent: () => current,
      resources,
      timed,
    }

    // A phase: the core's own work first (it is what the rules and hooks
    // extend), then the rules evaluated together, then each hook, each seeing
    // what the one before it returned. `of` is how a rule sees what the graph
    // already holds, beyond this batch; a phase with nothing gathered leaves
    // it out.
    let phase = (
      name: Phase,
      tx: Tx,
      core?: Step,
      of?: (eid: Eid) => Bundle | undefined,
    ): Step =>
    (bundles) => {
      let rules = ruled(name, o.stamp !== false)
      let calls = hooks(name)
      return timed(
        name,
        () => runPhase(run, name, tx, core, of, rules, calls, bundles),
      )
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
        after(
          outside.get([
            ...new Set(
              applied.filter((b) =>
                rules.some(([, rule]) => observes(rule, vocab, b))
              ).map((b) => b.entity.eid),
            ),
          ]),
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
                after(
                  fire([rule], {
                    vocab,
                    tx: outside,
                    phase: 'effect',
                    bundles: applied,
                    resources: shared,
                    of: (eid) =>
                      held.get(eid),
                    tracing: tracing && live(tracing) && peek(g)
                      ? { ...tracing, parent: current, plugin }
                      : undefined,
                  }),
                  (made) => [...b, ...made.slice(applied.length)],
                )))
          },
        )
      let made = rules.length ? observed('graph', applied, run) : applied
      return after(made, (b) =>
        after(
          each(hooks('effect'), b, (out, [plugin, hook]) =>
            observed(plugin, out, () =>
              tracing && live(tracing) && peek(g)
                ? timed(
                  'effect',
                  () =>
                    hook(out, outside, undefined, {
                      graph: g,
                      parent: current,
                    }),
                  plugin,
                )
                : hook(out, outside))),
          () =>
            b,
        ))
    }

    // After a rollback: the audit hooks, with the error that caused it — a
    // refusal, or the {@link Checked} error a dry run rolls back with. They
    // run outside the rolled-back transaction, because an audit row cannot be
    // written in the transaction it is recording the failure of. Every
    // rollback runs them, because a hook that wrote inside the transaction has
    // to be told its rows are gone, whatever ended it.
    let auditing = (bundles: Bundle[], err: unknown) =>
      each(hooks('audit'), bundles, (b, [plugin, hook]) => {
        try {
          let out = tracing && live(tracing) && peek(g)
            ? timed(
              'audit',
              () =>
                hook(b, outside, err, {
                  graph: g,
                  parent: current,
                  admission,
                }),
              plugin,
            )
            : hook(b, outside, err, { graph: g, admission })
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
      let done = tracing && live(tracing) && peek(g)
        ? timed('audit', () => auditing(bundles, err))
        : auditing(bundles, err)
      return isPromise(done) ? done.then(raise) : raise()
    }

    let inside = (bundles: Bundle[]): Bundle[] | Promise<Bundle[]> => {
      checking = admission && !fallback && certified(bundles)
      let run = (tx: Tx) => {
        tx = traced(tx)
        // Every read the phases before the write will make, taken as one call.
        // It is handed to those phases alone — a snapshot of the graph as the
        // batch found it is exactly what a precondition needs, and exactly
        // what a phase reading after the write must not have. `mutate` is one
        // of them: it reads which entities are already deleted before it
        // writes anything, and a patch made through the gathered transaction
        // is folded back into the snapshot, so those phases still see each
        // other's writes.
        return after(gathering(tx, bundles), (snap) => {
          if (checking) tx = rehearsing(tx, vocab, snap)
          let trackers: Tracker[] = []
          for (let p of plugins) {
            if (!p.track) continue
            let tracker = p.track(tx, (eid) => snap.got.get(eid))
            trackers.push(tracker)
            tx = tracker.tx
          }
          let flush: Step = (b) =>
            timed('flush', () => each(trackers, b, (out, t) => t.flush(out)))
          let held = holding(tx, vocab, snap)
          // What the graph holds for one entity, with every patch this batch
          // has made already folded in — what a rule is evaluated against
          // (./rules.ts).
          let holds = (eid: Eid) => snap.got.get(eid) ?? undefined
          let checks: WriteHook[] | undefined
          return after(
            each(
              [
                phase(
                  'precondition',
                  held,
                  (b) =>
                    after(guard(b, held, vocab), (guarded) => {
                      if (!admission || !o.overlay?.length) {
                        return guarded
                      }
                      let ids = new Set(guarded.map((b) => b.entity.eid))
                      let overlay = composed(o.overlay).filter((b) =>
                        ids.has(b.entity.eid)
                      )
                      return after(
                        held.get(overlay.map((b) => b.entity.eid)),
                        () => {
                          for (let row of overlay) {
                            if (!snap.got.get(row.entity.eid)) continue
                            let peer: Bundle = { entity: row.entity }
                            for (let [name, patch] of comps(row)) {
                              if (syncOf(vocab, name) != 'peers') continue
                              peer[name] = patch
                              snap.only?.get(row.entity.eid)?.add(name)
                            }
                            let eid = row.entity.eid
                            snap.got.set(
                              eid,
                              merged(snap.got.get(eid) ?? null, peer),
                            )
                          }
                          return guarded
                        },
                      )
                    }),
                ),
                (b: Bundle[]) => admission ? overlaid(b, vocab, o.overlay) : b,
                // The declared rules, before any row of the batch is
                // written: what they produce joins the batch, and `mutate`
                // writes it like anything else.
                phase(
                  'rules',
                  held,
                  (b) => {
                    let rules = declaring().filter((r) =>
                      opts.runs ? opts.runs(r, o) : !own(r, vocab)
                    )
                    if (!rules.length) return b
                    // A resource a declared rule writes (`+result.at=#Now`)
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
                      tracing && live(tracing) && peek(g)
                        ? { ...tracing, parent: current }
                        : undefined,
                    )
                  },
                  holds,
                ),
                phase('mutate', held, (b) => {
                  if (checking && !certified(b)) throw new NeedsWrite()
                  checks = plugins.flatMap((p) => {
                    let check = p.beforeWrite?.(b)
                    return check ? [check] : []
                  })
                  return checks.length
                    ? ordered(b, tx, vocab, snap, st, checks)
                    : mutate(b, held, st, vocab)
                }),
                phase(
                  'cascade',
                  tx,
                  (b) =>
                    after(
                      b.length ? complete(tx, snap) : undefined,
                      () => checks?.length ? b : cascade(b, tx, vocab, st),
                    ),
                ),
                // The stamps are rules, and they ask what the graph already
                // holds for an entity: a newly created entity is one with no
                // `created` component.
                phase('stamp', tx, (b) => births(b, st), holds),
                // Journal and commit hooks read the classified writes. Their
                // own writes need the second flush after those hooks finish.
                flush,
                (b: Bundle[]) => {
                  if (checking && !certified(b)) {
                    throw new NeedsWrite()
                  }
                  return b
                },
                ...(checking
                  ? [(b: Bundle[]) => st.heard.length ? rejoin(b, st.heard) : b]
                  : [
                    phase('journal', tx),
                    // What was heard and never written joins the batch again.
                    (b: Bundle[]) => st.heard.length ? rejoin(b, st.heard) : b,
                    phase('commit', tx),
                    flush,
                  ]),
              ],
              bundles,
              (b, step) => step(b),
            ),
            (b) => {
              if (o.check && !checking) {
                throw new Checked(b)
              }
              return b
            },
          )
        })
      }
      // A rolled-back dry run is not a refusal: it is audited like any other
      // rollback, then returns what the phases produced, and skips the
      // effects, which observe committed data only.
      let fell = (e: unknown): Bundle[] | Promise<Bundle[]> =>
        e instanceof NeedsWrite
          ? (fallback = true, inside(bundles))
          : e instanceof Checked
          ? after(
            auditing(bundles, e),
            () => e.bundles,
          )
          : audited(bundles, e)
      let committed: Bundle[] | Promise<Bundle[]>
      try {
        committed = timed(
          'transaction',
          () => storage.tx(run, { admission: checking }),
        )
      } catch (e) {
        return fell(e)
      }
      let observe = (b: Bundle[]) => {
        if (checking) return b
        let defer = o.deferEffects ?? opts.deferEffects
        if (!defer) {
          return tracing ? timed('effect', () => effects(b)) : effects(b)
        }
        // Sample the calling program's clock while its transaction-scoped
        // context still exists.
        moment()
        defer(() =>
          after(
            tracing ? timed('effect', () => effects(b)) : effects(b),
            () => {},
          )
        )
        return b
      }
      return isPromise(committed)
        ? committed.then(observe, fell)
        : observe(committed)
    }

    // Resolve only the refs admission keeps. Server-owned or computed input
    // values that admission discards must not introduce a lookup or refusal.
    let referring = (named: Bundle[]): Bundle[] | Promise<Bundle[]> => {
      let targets = new Set(
        named.filter((row) => gives(row) && !dead(row))
          .map((row) => row.entity.eid),
      )
      let refs = named.flatMap((row, i) =>
        comps(row).flatMap(([comp, patch]) =>
          Object.entries(patch ?? {}).flatMap(([prop, value]) => {
            let p = vocab.prop(comp, prop)
            return p?.category == 'ref' && typeof value == 'string' &&
                !isAlias(value) && !targets.has(value)
              ? [{ i, comp, prop, value, kind: String(p.ref) }]
              : []
          })
        )
      )
      return each(
        refs,
        named,
        (out, { i, comp, prop, value, kind }) =>
          after(
            referenced(
              { ...outsideRead(), vocab, address },
              [value],
              kind,
            ),
            ([eid]) => {
              out[i] = {
                ...out[i],
                [comp]: { ...out[i][comp] as Comp, [prop]: eid },
              }
              return out
            },
          ),
      )
    }

    // The run, end to end: the phases before the transaction, the transaction,
    // and then the return value — composed once, at the point every exit from
    // `apply()` passes through, the commit and a dry run's rollback alike.
    return each(
      [
        // Every id the batch names — a bundle's own, a reference's —
        // resolved the way a read and a tool's arguments resolve theirs, so a
        // name or a `T-7` lands on the entity it names and one that names
        // nothing is refused before anything is minted under it.
        phase(
          'normalize',
          outside,
          (b) =>
            after(
              address(
                b.map((row) => row.entity.eid).filter((id) => !isAlias(id)),
              ),
              (at) => substitute(b, vocab, at),
            ),
        ),
        // Accepted data is copied, never admitted again. Like accepted release
        // declarations, it may predate the current writer's admission rules.
        o.trusted && o.replica ? (b: Bundle[]) => known(b, vocab) : phase(
          'admit',
          outside,
          (b) =>
            after(
              admit(
                requested(
                  o.replica ? known(b, vocab) : b,
                  plugins.flatMap((p) => p.requests ?? []),
                ),
                vocab,
                o.trusted,
                opts.teach,
                o.replica,
              ),
              referring,
            ),
        ),
        // Derive the id, then check it still matches: an id derived from a
        // value is only meaningful while the two agree (identity.ts
        // `identified`).
        phase(
          'mint',
          outside,
          (b) => identified(resolve(b, vocab, derives(), mint), vocab),
        ),
        phase('prepare', outside),
        inside,
        (b) => timed('compose', () => composed(b)),
      ],
      owned(formed(bundles)),
      (b, step) => step(b),
    )
  }

  let apply = (
    bundles: Bundle[],
    o: AdmitOpts = {},
    admission = false,
  ): Bundle[] | Promise<Bundle[]> => {
    let c = peek(g)
    if (!c) return applying(bundles, o, undefined, admission)
    let epoch = recording(c)
    let span = c.begin({
      kind: 'apply',
      name: admission ? 'admit' : 'apply',
      package: '@yaks/graph',
      parent: o.parent ?? parent(g, bundles),
    })
    return during(
      span,
      () =>
        applying(bundles, o, {
          channel: c,
          parent: span?.id,
          recording: epoch,
        }, admission),
      o.check ? 'check' : 'ok',
      (out) => ({ input: bundles.length, output: out.length }),
    )
  }

  let reads = reading({ storage, vocab, plugins, outside: outsideRead })
  let { address, ask, answer, view, rewrites, read, rows, get } = reads

  let g: Graph = {
    vocab,
    worn: (comp, prop) => storage.worn?.(comp, prop) ?? false,
    storage,
    outside: detached(storage),
    plugins,
    address,
    rewrites,
    ask,
    answer,
    view,
    use: (plugin) => {
      plugins.push(plugin)
      reads.use(plugin)
      return g
    },
    install: () => storage.install(),
    // The rows carry what the query names (./projection.ts), the same answer
    // at every door. A `.fields` projection is read as its rows, and answers
    // the entities its paths reach beside the ones it selects.
    read: (query, readOpts) => {
      let c = peek(g)
      if (!c) return read(query, readOpts)
      return during(
        c.begin({
          kind: 'query',
          name: 'read',
          package: '@yaks/graph',
          parent: readOpts?.parent,
        }),
        () => read(query, readOpts),
        'ok',
        (out) => ({ rows: out.length }),
      )
    },
    rows: (query, readOpts) => {
      let c = peek(g)
      if (!c) {
        return rows(query, readOpts)
      }
      return during(
        c.begin({
          kind: 'query',
          name: 'rows',
          package: '@yaks/graph',
          parent: readOpts?.parent,
        }),
        () => rows(query, readOpts),
        'ok',
        (out) => ({ rows: out.length }),
      )
    },
    get: (eids, comps, readOpts) => {
      let c = peek(g)
      if (!c) return get(eids, comps, readOpts)
      return during(
        c.begin({
          kind: 'get',
          name: 'get',
          package: '@yaks/graph',
          parent: readOpts?.parent,
        }),
        () => get(eids, comps, readOpts),
        'ok',
        (out) => ({ input: eids.length, rows: out.length }),
      )
    },
    apply,
    admit: (bundles, o) => apply(bundles, { ...o, check: true }, true),
  }
  return g
}
