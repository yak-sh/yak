// A graph in a Map. This is @yaks/graph's `Storage` with nothing underneath it
// — one record per entity, keyed by eid, held in a plain Map — so a graph can
// run in a page, in a worker, or in a test with no database to install, no
// driver to bind, and no promise to await.
//
// Reads go through @yaks/match: the same query string @yaks/sql compiles into a
// SQL statement is evaluated here as a predicate over the bundles the map
// holds. This file hands the matcher its rows the way a database hands a plan
// its tables: by id, by the component an entity wears, and by the value a
// property holds, so a query that names a component or asks for a value reads
// those entities and no others.
//
// Writes follow the patch rules every adapter implements — omitted properties
// untouched, a null property cleared, a null component dropped, a tombstoned
// entity taking no patch until `revive` brings it back under the identity it
// kept — and identity belongs to storage: `patch` creates a
// record for every eid the write touches or points at, numbers each new one in
// the order it was first touched, and returns what it created.
//
// A record is the bundle a read answers with, and it is never mutated in place:
// a patch builds the next one and puts it in the map, and a patch that changes
// nothing keeps the one it found. So a read copies nothing, and rolling back is
// cheap — an undo log of one reference per entity a transaction touched,
// replayed backwards, restores the map and its indexes exactly as they were
// without copying anything the write did not touch.
//
// The same log is how declared rules see a batch before it is written: the
// batch is patched in, the rules are asked (./rules.ts), and the log is
// rewound, so a rule reads the graph as the batch would leave it through the
// same indexes every read uses, and nothing it saw outlives the question.

import type {
  Binding,
  Bundle,
  Comp,
  Doom,
  Eid,
  Entity,
  Graves,
  Match,
  ReadOpts,
  Row,
} from '@yaks/graph'
import { isPromise, same } from '@yaks/fp'
import { comps, dead, TOMBSTONE, tombstoned } from '@yaks/graph/bundle'
import { only } from '@yaks/graph/read'
import { renumbering } from '@yaks/graph/storage'
import {
  type Computed,
  type Index,
  index,
  keyOf,
  matcher,
  type Query,
  rows as answer,
  statusOf,
} from '@yaks/match'
import type { Vocab } from '@yaks/vocab'
import { bindings } from './rules.ts'

export type { Query }

/** Passed to every read of a store: the moment relative time phrases in a query
 * (`.released=today`) resolve against. A per-call `opts` overrides it. */
export type RamOpts = {
  /** the reference moment for time phrases (default: the read's own `now`) */
  now?: number
  /** never assign a number, and take the `num` a patch states unchecked.
   * This is what a store mirroring another graph needs — a client applying the
   * bundles a server returned is being told the identity, not choosing it. An
   * entity it has not been told a number for has none: a number it guessed
   * could be another entity's. Off by default: a store that mirrors nothing
   * owns its own numbering, and gives a stated number only where no other
   * entity holds it. Such a store also keeps the computed values it is sent,
   * as the graph it mirrors derived them. */
  adopt?: boolean
  /** Give new entities a human-readable number. Opt-IN, with the same option
   * name @yaks/sqlite uses: left out, an entity has its eid and nothing else.
   * `{ except: [comp, …] }` turns numbering on while leaving the entities of
   * the named components unnumbered. */
  number?: boolean | { except: readonly string[] }
  /** `comp.prop` → the value for one bundle, for each property the vocabulary
   * declares computed and never stores: what `.task.status=open` is answered
   * with here, the way @yaks/sql answers it with a `derived` expression. A
   * package that declares one ships the rule (@yaks/task `compute`). Left out,
   * a query on a computed property is refused, naming it. */
  computed?: Computed
}

/**
 * A transaction over the map: @yaks/graph's `Tx`, implemented synchronously.
 * The store commits when the body returns and rolls back when it throws, so a
 * rejected write leaves the map exactly as it found it.
 */
export type Tx = {
  /** a query → whole bundles, or only `comps` when named */
  read: (query: Query, opts?: ReadOpts, comps?: string[]) => Bundle[]
  /** lookup by id, not search: these entities as they stand, carrying the
   * components `comps` names or every one. A deleted one carries `tombstone`;
   * an unknown one is simply absent. */
  get: (eids: Eid[], comps?: string[], opts?: ReadOpts) => Bundle[]
  /** what declared rules are evaluated through: every match run against this
   * graph with `bundles` folded in, as though it had been written, and nothing
   * of it left behind */
  bindings: (matches: Match[], bundles: Bundle[]) => Binding[][]
  /** The deletion closure and references to clear, from the stored index. */
  doom: (eids: Eid[]) => Doom | null
  /** apply these patches → the entities they created, each with its `num` */
  patch: (bundles: Bundle[]) => Entity[]
  /** Evict live payloads, not identities. A later patch keeps the same number.
   * A tombstone stays; eviction is never deletion. */
  evict: (eids: Eid[]) => void
  /** remove these entities: their components go, their identity is tombstoned */
  remove: (entities: Entity[]) => void
  /** Erase identities the graph has checked as empty and unreferenced. */
  prune: (eids: Eid[]) => void
  /** bring these tombstoned entities back, with their identity and no
   * components */
  revive: (eids: Eid[]) => void
}

/**
 * A bound store: @yaks/graph's `Storage`, implemented synchronously. It has
 * the same five members a database adapter has, so it satisfies `Storage`
 * wherever one is wanted — and a caller using a `Store` directly never awaits
 * a row.
 */
export type Store = {
  /** Whether a value this store reads for the property means its entity
   * wears the component. */
  worn: (comp: string, prop: string) => boolean
  /** nothing to create — installing a map is a no-op */
  install: () => void
  /** a query → its entities, with `comps` only where named */
  read: (query: Query, opts?: ReadOpts, comps?: string[]) => Bundle[]
  /** a query → one raw `{ eid }` row per match, or an aggregate's rows */
  rows: (query: Query, opts?: ReadOpts) => Row[]
  /** these entities as they stand, carrying the components `comps` names or
   * every one */
  get: (eids: Eid[], comps?: string[], opts?: ReadOpts) => Bundle[]
  /** tombstones laid before `before` that nothing refers to, oldest first,
   * resuming at `after` */
  buried: (before: string, page: { after?: string; limit: number }) => Graves
  /** run `body` in a transaction: commit on return, roll back on throw */
  tx: <R>(body: (tx: Tx) => R) => R
}

// A deleted entity keeps its identity and a tombstone, and nothing else, until
// `revive` brings it back.
let buried = (b: Bundle | undefined): boolean => b?.[TOMBSTONE] != null
// An entity that holds nothing yet: the record a reference made.
let empty = (b: Bundle): boolean => {
  for (let k in b) if (k != 'entity') return false
  return true
}
let NONE: ReadonlyMap<Eid, Bundle> = new Map()
let file = <K>(
  byKey: Map<K, Map<Eid, Bundle>>,
  key: K,
  eid: Eid,
  b: Bundle,
) => {
  let at = byKey.get(key)
  if (!at) byKey.set(key, at = new Map())
  at.set(eid, b)
}
let unfile = <K>(byKey: Map<K, Map<Eid, Bundle>>, key: K, eid: Eid) => {
  let at = byKey.get(key)
  if (at?.delete(eid) && !at.size) byKey.delete(key)
}
// The band a value files under in a number index: the whole number at or below
// it, read the way a number comparison reads it (@yaks/match), so every value a
// range selects is in one of the bands the range spans.
let bandOf = (v: unknown): number | undefined => {
  if (v == null) return undefined
  let n = Math.floor(Number(v))
  return Number.isNaN(n) ? undefined : n
}
// One property of a record, or undefined.
let valueOf = (b: Bundle | undefined, comp: string, prop: string): unknown =>
  (b?.[comp] as Comp | undefined)?.[prop]

// A vocabulary never changes: resolve its status-bearing components once,
// rather than inspect every component of every row each time it is gathered.
let ladders = new WeakMap<Vocab, string[]>()

/**
 * A store over a Map of bundles, bound to a vocabulary once. It is the storage
 * a client graph and a fast test run on:
 *
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { loadVocab } from '@yaks/vocab'
 * import { docDoc } from '@yaks/doc'
 * import { ram } from '@yaks/ram'
 *
 * let vocab = loadVocab([docDoc])
 * let g = graph({ storage: ram(vocab), vocab })
 * g.apply([{ entity: { eid: 'b1' }, doc: { title: 'Dune' } }])
 * g.read('.kind=doc')
 * ```
 */
export let ram = (vocab: Vocab, base: RamOpts = {}): Store => {
  // One bundle per entity: the answer a read hands back, built once per write.
  let rows = new Map<Eid, Bundle>()
  // Compact identity reservations survive payload eviction. They are not query rows.
  let cold = new Map<Eid, Entity>()
  // What a query reads instead of every row: the entities wearing each
  // component, and — for each property a query has asked for by value — the
  // entities by the key their value files under (@yaks/match `keyOf`), or for
  // each number a query has asked for a range of, by band (`bandOf`).
  let worn = new Map<string, Map<Eid, Bundle>>()
  let filed = new Map<
    string,
    [string, string, Map<string, Map<Eid, Bundle>>]
  >()
  let banded = new Map<
    string,
    [string, string, Map<number, Map<Eid, Bundle>>]
  >()
  // The same declared uniqueness that SQLite enforces on its indexes, each
  // component's taken from the vocabulary when a row first wears it. A
  // transaction's rollback travels through `put`, restoring these as well.
  type Unique = {
    comp: string
    index: ReturnType<Vocab['indexes']>[number]
    held: Map<string, Eid>
  }
  let uniques = new Map<string, Unique[]>()
  let uniqueOf = (comp: string): Unique[] => {
    let got = uniques.get(comp)
    if (!got) {
      uniques.set(
        comp,
        got = !vocab.comp(comp) ? [] : vocab.indexes(comp)
          .filter((i) => i.unique)
          .map((index) => ({ comp, index, held: new Map() })),
      )
    }
    return got
  }
  let hasUnique = vocab.all.some((name) =>
    vocab.indexes(name).some((i) => i.unique)
  )
  let uniqueKey = (
    b: Bundle | undefined,
    comp: string,
    props: string[],
    present: string[] = [],
  ): string | undefined => {
    if (!b?.[comp] || present.some((p) => valueOf(b, comp, p) == null)) {
      return undefined
    }
    let values = props.map((p) => keyOf(valueOf(b, comp, p)))
    return values.some((v) => v === undefined)
      ? undefined
      : JSON.stringify(values)
  }
  let next = 1
  // The entity each number was last given to, a tombstone's and an evicted
  // payload's included. Never pruned: an entry is checked against the
  // entity's own number when asked (`holder`), so one given away since says
  // nothing.
  let given = new Map<number, Eid>()
  let numOf = (eid: Eid) => (rows.get(eid)?.entity ?? cold.get(eid))?.num
  let holder = (num: number) => {
    let eid = given.get(num)
    return eid && numOf(eid) === num ? eid : undefined
  }
  // When each tombstone was laid, keyed by the record itself, so a rollback
  // that puts an earlier record back takes the time with it.
  let laid = new WeakMap<Bundle, string>()
  // The undo log: for each entity a transaction is about to change, the record
  // it held first. Replayed backwards, it is the rollback.
  let log: [Eid, Bundle | undefined, Entity | undefined][] = []
  let depth = 0
  let save = (eid: Eid) => log.push([eid, rows.get(eid), cold.get(eid)])
  // Back to where the log stood at `mark`, and the numbering with it.
  let rewind = (mark: number, minted: number) => {
    while (log.length > mark) {
      let [eid, rec, identity] = log.pop()!
      if (identity) cold.set(eid, identity)
      else cold.delete(eid)
      put(eid, rec)
    }
    next = minted
  }

  // One entity's record replaced, or dropped, and every index moved with it.
  // Every write goes through here, a rollback's included, so an index never
  // disagrees with the rows.
  let put = (eid: Eid, b: Bundle | undefined) => {
    let was = rows.get(eid)
    let checks: Unique[] = []
    // Components are immutable; their unique keys stay held by the same eid
    // when another component changes. Row-bearing indexes still move below.
    if (hasUnique) {
      for (let comp in was) {
        if (was[comp] !== b?.[comp]) checks.push(...uniqueOf(comp))
      }
      for (let comp in b) {
        if (!was || !(comp in was)) checks.push(...uniqueOf(comp))
      }
    }
    for (let { comp, index, held } of checks) {
      let key = uniqueKey(b, comp, index.props, index.present)
      if (key !== undefined && held.has(key) && held.get(key) != eid) {
        throw new Error(
          `unique constraint failed: ${comp}.${index.props.join(', ')}`,
        )
      }
    }
    if (b) rows.set(eid, b)
    else rows.delete(eid)
    if (b?.entity.num != null) given.set(b.entity.num, eid)
    for (let { comp, index, held } of checks) {
      let from = uniqueKey(was, comp, index.props, index.present)
      let to = uniqueKey(b, comp, index.props, index.present)
      if (from !== undefined && from != to) held.delete(from)
      if (to !== undefined) held.set(to, eid)
    }
    if (was) {
      for (let name in was) {
        if (name != 'entity' && !(b && name in b)) worn.get(name)?.delete(eid)
      }
    }
    if (b) {
      for (let name in b) {
        if (name == 'entity') continue
        let at = worn.get(name)
        if (!at) worn.set(name, at = new Map())
        at.set(eid, b)
      }
    }
    for (let [comp, prop, byKey] of filed.values()) {
      let from = keyOf(valueOf(was, comp, prop))
      let to = keyOf(valueOf(b, comp, prop))
      if (from !== undefined && from !== to) unfile(byKey, from, eid)
      if (to !== undefined) file(byKey, to, eid, b!)
    }
    for (let [comp, prop, byBand] of banded.values()) {
      let from = bandOf(valueOf(was, comp, prop))
      let to = bandOf(valueOf(b, comp, prop))
      if (from !== undefined && from !== to) unfile(byBand, from, eid)
      if (to !== undefined) file(byBand, to, eid, b!)
    }
  }

  // The keyed index over one property: filed from the component index the
  // first time a query asks for it, and kept by `put` from then on.
  let keys = (comp: string, prop: string): Map<string, Map<Eid, Bundle>> => {
    let at = `${comp}.${prop}`
    let held = filed.get(at)
    if (held) return held[2]
    let byKey = new Map<string, Map<Eid, Bundle>>()
    filed.set(at, [comp, prop, byKey])
    for (let [eid, b] of worn.get(comp) ?? NONE) {
      let key = keyOf(valueOf(b, comp, prop))
      if (key !== undefined) file(byKey, key, eid, b)
    }
    return byKey
  }

  // The number index over one property, filed the same way the first time a
  // query asks for a range of it.
  let bands = (comp: string, prop: string): Map<number, Map<Eid, Bundle>> => {
    let at = `${comp}.${prop}`
    let held = banded.get(at)
    if (held) return held[2]
    let byBand = new Map<number, Map<Eid, Bundle>>()
    banded.set(at, [comp, prop, byBand])
    for (let [eid, b] of worn.get(comp) ?? NONE) {
      let band = bandOf(valueOf(b, comp, prop))
      if (band !== undefined) file(byBand, band, eid, b)
    }
    return byBand
  }

  // The bands a range spans: counted off one by one when there are fewer of
  // them than bands filed, else picked out of the ones filed.
  let ranged = (comp: string, prop: string, lo: number, hi: number) => {
    let byBand = bands(comp, prop)
    let a = Math.floor(lo)
    let z = Math.floor(hi)
    let out: ReadonlyMap<Eid, Bundle>[] = []
    if (z - a < byBand.size) {
      for (let k = a; k <= z; k++) {
        let at = byBand.get(k)
        if (at) out.push(at)
      }
    } else {
      for (let [k, at] of byBand) if (k >= a && k <= z) out.push(at)
    }
    return out
  }

  // What one read sees: every row, by id, by component and by value, and what
  // a batch under evaluation removed. A fresh view per read, so what a run
  // keeps against it (a walk's closure) never outlives the rows it was worked
  // out from.
  let view = (gone?: Index['gone']): Index => {
    let list: Bundle[] | undefined
    return {
      get list() {
        return list ??= [...rows.values()]
      },
      of: (eid) => rows.get(eid),
      wearing: (comp) => worn.get(comp) ?? NONE,
      keyed: (comp, prop, key) => keys(comp, prop).get(key) ?? NONE,
      ranged,
      gone,
    }
  }

  // Resolve storage policy once per component, not on every moving cell.
  // The vocabulary belongs to this store and is fixed for its lifetime.
  let cells = new Map<string, { refs: Set<string>; kept: Set<string> }>()
  let cellsOf = (comp: string) => {
    let held = cells.get(comp)
    if (!held) {
      let refs = new Set<string>()
      let kept = new Set<string>()
      for (let name of vocab.props(comp)) {
        let prop = vocab.prop(comp, name)!
        if (prop.category == 'ref') refs.add(name)
        if (!prop.computed || base.adopt) kept.add(name)
      }
      cells.set(comp, held = { refs, kept })
    }
    return held
  }
  let isRef = (comp: string, prop: string) => cellsOf(comp).refs.has(prop)

  // The properties of a patch this vocabulary stores. A component whose patch
  // names none is still a component: its presence is the fact. A store that
  // mirrors another graph keeps the computed values that graph sent, since it
  // holds no rule to derive them.
  // Bytes cross the storage boundary by value, just as a database BLOB does.
  // Keep the ordinary immutable-bundle path allocation-free.
  let binary = vocab.all.flatMap((comp) => {
    let props = vocab.props(comp).filter((p) =>
      vocab.prop(comp, p)?.scalar == 'binary'
    )
    return props.length ? [{ comp, props }] : []
  })
  let detached = (b: Bundle): Bundle => {
    let out = b
    for (let { comp, props } of binary) {
      let held = b[comp] as Comp | undefined
      if (!held) continue
      for (let prop of props) {
        let value = held[prop]
        if (value instanceof Uint8Array) {
          if (out === b) out = { ...b }
          if (out[comp] === held) out[comp] = { ...held }
          ;(out[comp] as Comp)[prop] = value.slice()
        }
      }
    }
    return out
  }

  // A mirror also keeps computed values its source sent. Bytes retain the
  // storage boundary's by-value ownership.
  let stored = (comp: string, patch: Comp): Comp => {
    let out: Comp = {}
    let kept = cellsOf(comp).kept
    for (let p in patch) {
      if (!kept.has(p)) continue
      let value = patch[p]
      out[p] =
        value instanceof Uint8Array && vocab.prop(comp, p)?.scalar == 'binary'
          ? value.slice()
          : value
    }
    return out
  }

  // Reads carry the computed values a server would send, without storing
  // them. Compute against the whole index before cutting requested components.
  let statuses = ladders.get(vocab)
  if (!statuses) {
    ladders.set(
      vocab,
      statuses = vocab.all.filter((name) => vocab.comp(name)?.ladder),
    )
  }
  let derived = Object.entries(base.computed ?? {}).map(([path, read]) =>
    [...path.split('.'), read] as [string, string, Computed[string]]
  )
  let computed = (b: Bundle, among: Index, names?: string[]): Bundle => {
    let out = b
    for (let name of statuses) {
      if (names && !names.includes(name)) continue
      let value = b[name] as Comp | undefined
      if (!value) continue
      out = { ...out, [name]: { ...value, status: statusOf(vocab, name, b) } }
    }
    for (let [name, prop, read] of derived) {
      if (names && !names.includes(name)) continue
      if (!b[name]) continue
      let value = read(b, among)
      let comp = { ...out[name] as Comp }
      if (value == null) delete comp[prop]
      else comp[prop] = value
      out = { ...out, [name]: comp }
    }
    return out
  }

  // Remove hidden relations before the matcher can inspect a value or follow
  // a reference. Every index for this read is built from this visible dataset.
  // A deleted entity is judged by its history (@yaks/sql `ghostly`), and
  // this store keeps none, so no scope sees it here.
  let visible = (opts: ReadOpts): Index | Bundle[] => {
    let scope = opts.visibility
    if (!scope) return view()
    let source = view()
    let screen = { now: opts.now ?? base.now, exactIds: true }
    let allowed = scope.entity
      ? matcher(scope.entity, vocab, screen)(source)
      : source.list
    let components = Object.entries(scope.components ?? {}).map(([name, q]) =>
      [
        name,
        new Set(matcher(q, vocab, screen)(source).map((b) => b.entity.eid)),
      ] as const
    )
    let present = new Set(allowed.map((b) => b.entity.eid))
    return index(allowed.map((b) => {
      let out = { ...b }
      for (let [name, owners] of components) {
        if (!owners.has(b.entity.eid)) delete out[name]
      }
      for (let [name, value] of comps(out)) {
        if (!value) continue
        for (let prop of vocab.props(name)) {
          if (
            isRef(name, prop) && typeof value[prop] == 'string' &&
            !present.has(value[prop] as string)
          ) {
            let comp = { ...out[name] as Comp }
            delete comp[prop]
            out[name] = comp
          }
        }
      }
      // Archetype metadata describes stored components, not this caller's view.
      out.entity = {
        eid: b.entity.eid,
        ...b.entity.num === undefined ? {} : { num: b.entity.num },
      }
      return out
    }))
  }

  let read = (
    query: Query,
    opts: ReadOpts = {},
    comps?: string[],
  ): Bundle[] => {
    let among = visible(opts) as Index
    let found = matcher(query, vocab, {
      now: opts.now ?? base.now,
      storageOrder: opts.storageOrder,
      unordered: opts.unordered,
      eids: opts.eids,
      graves: opts.graves,
      computed: base.computed,
    })(among)
    let gathered = statuses.length || derived.length
      ? found.map((b) => computed(b, among, comps))
      : found
    return (comps ? gathered.map(only(new Set(comps))) : gathered).map(detached)
  }

  // The raw-rows path: one `{ eid }` per match, or an aggregate's rows in the
  // shape @yaks/sql returns, so a caller reads the same shape from either
  // storage.
  let raw = (query: Query, opts: ReadOpts = {}): Row[] =>
    answer(query, vocab, {
      now: opts.now ?? base.now,
      storageOrder: opts.storageOrder,
      unordered: opts.unordered,
      eids: opts.eids,
      graves: opts.graves,
      computed: base.computed,
    })(visible(opts)).map((row) => {
      if (!Object.values(row).some((v) => v instanceof Uint8Array)) return row
      return Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          value instanceof Uint8Array ? value.slice() : value,
        ]),
      )
    })

  // The number an identity gets when no bundle states one: the next this
  // store has to give, or none in a store mirroring another graph, which waits
  // to be told.
  let numbered = (): { num?: number } => base.adopt ? {} : { num: next++ }

  let patch = (bundles: Bundle[]): Entity[] => {
    let born: Entity[] = []
    let excluded = new Set<string>()
    if (typeof base.number == 'object') {
      for (let name of base.number.except) {
        for (let b of bundles) {
          if (rows.get(b.entity.eid)?.[name] != null) {
            excluded.add(b.entity.eid)
          }
        }
        for (let b of bundles) if (b[name] != null) excluded.add(b.entity.eid)
      }
      // Exclusions stop new allocations; an existing number is an address
      // somebody may already hold, so it stays with its entity.
    }
    // The number each bundle states for its entity: one to take, or `null`
    // for none. A mirror is told it, whatever its vocabulary says; any other
    // store takes one where its vocabulary declares numbers (@yaks/id), and
    // checks it first, against every number its entities hold.
    let stated = new Map<Eid, number | null>()
    let told = base.adopt || !!vocab.prop('entity', 'num')
    for (let b of told ? bundles : []) {
      if (b.entity.num !== undefined && !buried(rows.get(b.entity.eid))) {
        stated.set(b.entity.eid, b.entity.num)
      }
    }
    if (!base.adopt && stated.size) {
      let held = new Map<number, Eid>()
      for (let num of stated.values()) {
        let eid = num == null ? undefined : holder(num)
        if (eid) held.set(num!, eid)
      }
      renumbering(stated, numOf, held)
    }
    // A stated number, as an identity carries it; the next number this store
    // gives stays past every one it holds.
    let take = (eid: Eid): { num?: number } => {
      let num = stated.get(eid)
      if (num == null) return {}
      next = Math.max(next, num + 1)
      return { num }
    }
    let unnumbered = ({ num: _, ...entity }: Entity): Entity => entity
    // An eid a reference only names gets a record to hold the pointer and no
    // number, until a bundle of its own arrives (@yaks/sqlite `patch`): one
    // giving it a component, or one stating its number.
    let own = new Set(
      bundles.filter((b) =>
        !buried(rows.get(b.entity.eid)) &&
        (comps(b).some(([, c]) => c != null) || stated.has(b.entity.eid))
      ).map((b) => b.entity.eid),
    )
    let counts = (eid: Eid) => !!base.number && !excluded.has(eid)
    // Create a record for every eid this write touches or points at, so that a
    // reference may name a target created by the same write, in any order.
    let birth = (eid: Eid) => {
      let rec = rows.get(eid)
      let told = stated.has(eid)
      if (rec) {
        if (told && (rec.entity.num ?? null) !== stated.get(eid)) {
          // A number stated for an entity holding another: changed, or
          // cleared by `null`.
          save(eid)
          let entity = { ...unnumbered(rec.entity), ...take(eid) }
          put(eid, { ...rec, entity })
        } else if (
          // A record an earlier reference made is numbered when a bundle of
          // its own arrives, if it still carries nothing: an unnumbered entity
          // that carries something was left unnumbered on purpose.
          !told && !base.adopt && own.has(eid) && counts(eid) &&
          !buried(rec) && rec.entity.num == null && empty(rec)
        ) {
          save(eid)
          let entity = { ...rec.entity, ...numbered() }
          put(eid, { ...rec, entity })
          born.push(entity)
        }
        return
      }
      save(eid)
      let reserved = cold.get(eid)
      cold.delete(eid)
      let entity = reserved
        ? told ? { ...unnumbered(reserved), ...take(eid) } : reserved
        : {
          eid,
          ...told ? take(eid) : own.has(eid) && counts(eid) ? numbered() : {},
        }
      put(eid, { entity })
      if (!reserved) born.push(entity)
    }
    for (let b of bundles) {
      if (buried(rows.get(b.entity.eid))) continue
      birth(b.entity.eid)
      for (let [name, comp] of comps(b)) {
        for (let prop in comp) {
          let val = comp[prop]
          if (val != null && isRef(name, prop)) birth(String(val))
        }
      }
    }
    for (let b of bundles) {
      let eid = b.entity.eid
      let rec = rows.get(eid)
      let patches = comps(b)
      let archetype = b.entity.archetype
      if (
        rec && archetype !== undefined && archetype !== rec.entity.archetype
      ) {
        save(eid)
        let entity = { ...rec.entity, archetype }
        put(eid, rec = { ...rec, entity })
      }
      if (!rec || buried(rec) || !patches.length) continue
      let held = merged(rec, patches)
      if (held == rec) continue
      save(eid)
      put(eid, held)
    }
    return born
  }

  // The record a patch leaves. A null component drops the row; anything else
  // merges in, so an omitted property keeps what it held and a null one clears
  // it. A patch that changes nothing leaves the very record it found: an
  // unchanged write is no write.
  let merged = (rec: Bundle, patches: [string, Comp | null][]): Bundle => {
    let held = rec
    let own = () => held == rec ? held = { ...rec } : held
    for (let [name, comp] of patches) {
      let was = held[name] as Comp | undefined
      if (comp == null) {
        if (was !== undefined) delete own()[name]
        continue
      }
      let now = stored(name, comp)
      if (!holds(was, now)) {
        let next = was ? { ...was, ...now } : now
        for (let p in now) if (now[p] == null) delete next[p]
        own()[name] = next
      }
    }
    return held
  }

  // Whether a component already holds every value a patch gives it.
  let holds = (was: Comp | undefined, now: Comp): boolean =>
    !!was &&
    Object.keys(now).every((p) =>
      now[p] == null
        ? !Object.hasOwn(was, p)
        : Object.hasOwn(was, p) && same(was[p], now[p])
    )

  // The records themselves. A record is never mutated once stored, so the one a
  // read hands back is safe to keep, and costs no copy; a record cut to the
  // named components is a copy only when it carries others.
  let get = (eids: Eid[], names?: string[], opts: ReadOpts = {}): Bundle[] => {
    let cut = only(names ? new Set(names) : null)
    let out: Bundle[] = []
    // Plain committed gets need neither a matcher view nor its closures.
    let among = opts.visibility || statuses.length || derived.length
      ? visible(opts) as Index
      : undefined
    let scoped = opts.visibility
      ? new Map(among!.list.map((b) => [b.entity.eid, b as Bundle]))
      : rows
    for (let eid of eids) {
      let rec = scoped.get(eid)
      if (rec) {
        out.push(detached(cut(among ? computed(rec, among, names) : rec)))
      }
    }
    return out
  }

  // The batch folded in, the matches asked, the log rewound. What the batch
  // took a component off is its own list, since a removed component leaves
  // nothing in a row to ask about; one written again later in the batch is
  // not gone. A deleted entity is removed, and matches nothing.
  let ask = (matches: Match[], bundles: Bundle[]): Binding[][] => {
    if (!matches.length) return []
    let mark = log.length
    let minted = next
    try {
      tx.remove(bundles.filter(dead).map((b) => b.entity))
      patch(bundles.filter((b) => !dead(b)))
      let gone = new Map<string, Set<Eid>>()
      for (let b of bundles) {
        for (let [name, c] of comps(b)) {
          let at = gone.get(name) ?? new Set()
          if (c == null) gone.set(name, at.add(b.entity.eid))
          else at.delete(b.entity.eid)
        }
      }
      let anchor = bundles.length
        ? new Set(bundles.map((b) => b.entity.eid))
        : undefined
      return bindings(
        matches,
        view((comp) => gone.get(comp)),
        anchor,
        vocab,
        { now: base.now, computed: base.computed },
      )
    } finally {
      rewind(mark, minted)
    }
  }

  // Resolve deletion through the same reference indexes queries use.
  let doom = (eids: Eid[]): Doom | null => {
    let cascade = vocab.deaths('cascade')
    let soft = [...vocab.deaths('release'), ...vocab.deaths('detach')]
    if ([...cascade, ...soft].some(([c, p]) => base.computed?.[`${c}.${p}`])) {
      return null
    }
    let owners = (targets: Eid[], props: [string, string][]): Bundle[] => {
      let found = new Map<Eid, Bundle>()
      for (let [comp, prop] of props) {
        if (!worn.has(comp)) continue
        let held = keys(comp, prop)
        for (let target of targets) {
          for (let [eid, b] of held.get(keyOf(target)!) ?? NONE) {
            found.set(eid, b)
          }
        }
      }
      return [...found.values()].sort((a, b) =>
        (a.entity.num ?? 0) - (b.entity.num ?? 0)
      )
    }
    let gone = eids.map((eid) => ({ eid, depth: 0 }))
    let dead = new Set(eids)
    let front = eids
    for (let depth = 1; front.length; depth++) {
      let next: Eid[] = []
      for (let b of owners(front, cascade)) {
        let eid = b.entity.eid
        if (dead.has(eid)) continue
        dead.add(eid)
        gone.push({ eid, depth })
        next.push(eid)
      }
      front = next
    }
    let targets = [...dead]
    let loose: Doom['loose'] = []
    for (let b of owners(targets, soft)) {
      let eid = b.entity.eid
      if (dead.has(eid)) continue
      for (let [comp, prop] of soft) {
        let target = valueOf(b, comp, prop)
        if (target != null && dead.has(String(target))) {
          loose.push({ eid, comp, prop })
        }
      }
    }
    return { gone, loose }
  }

  let tx: Tx = {
    read,
    doom,
    get,
    bindings: ask,
    patch,
    evict: (eids) => {
      for (let eid of eids) {
        let rec = rows.get(eid)
        if (!rec || buried(rec)) continue
        save(eid)
        cold.set(eid, { eid, num: rec.entity.num })
        put(eid, undefined)
      }
    },
    remove: (entities) => {
      for (let { eid } of entities) {
        let entity = rows.get(eid)?.entity ?? cold.get(eid)
        if (!entity) continue
        save(eid)
        cold.delete(eid)
        let grave = tombstoned(entity)
        laid.set(grave, new Date().toISOString())
        put(eid, grave)
      }
    },
    prune: (eids) => {
      for (let eid of eids) {
        save(eid)
        cold.delete(eid)
        put(eid, undefined)
      }
    },
    revive: (eids) => {
      for (let eid of eids) {
        let rec = rows.get(eid)
        if (!rec || !buried(rec)) continue
        save(eid)
        put(eid, { entity: rec.entity })
      }
    },
  }

  // Tombstones laid before `before` that no stored reference names, oldest
  // first. The cursor is the last grave's time and eid, which still marks
  // the place once that grave is pruned.
  let graves = (
    before: string,
    page: { after?: string; limit: number },
  ): Graves => {
    let refs = vocab.refProps().filter(([c, p]) => !vocab.prop(c, p)?.computed)
    let named = (eid: Eid) =>
      refs.some(([c, p]) => worn.has(c) && !!keys(c, p).get(keyOf(eid)!)?.size)
    let mark = (at: string, eid: Eid) => JSON.stringify([at, eid])
    let found = [...rows].flatMap(([eid, b]) => {
      let at = laid.get(b)
      return at != null && at < before ? [mark(at, eid)] : []
    }).sort().filter((m) => page.after == null || m > page.after)
    let eids: Eid[] = []
    let next: string | undefined
    for (let m of found) {
      if (eids.length >= page.limit) break
      next = m
      let [, eid] = JSON.parse(m)
      if (!named(eid)) eids.push(eid)
    }
    return eids.length < page.limit || next == null ? { eids } : { eids, next }
  }

  return {
    // A computed override may read another component, even when its named
    // component is absent, so only a stored property's value says it is worn.
    worn: (comp, prop) =>
      !!vocab.prop(comp, prop) && !vocab.prop(comp, prop)?.computed &&
      !base.computed?.[`${comp}.${prop}`],
    install: () => {},
    read,
    rows: raw,
    get,
    buried: graves,
    tx: (body) => {
      // A nested transaction is a savepoint: it rolls back to where it opened,
      // and its entries stay in the log for the outer one to undo in its turn.
      let mark = log.length
      let minted = next
      depth++
      let undo = (e: unknown): never => {
        rewind(mark, minted)
        depth--
        throw e
      }
      let done = <R>(out: R): R => {
        if (--depth == 0) log.length = 0
        return out
      }
      try {
        let out = body(tx)
        return (isPromise(out) ? out.then(done, undo) : done(out)) as typeof out
      } catch (e) {
        return undo(e)
      }
    },
  }
}
