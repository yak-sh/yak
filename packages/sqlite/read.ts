// Reads: a query in, whole entities out. This is the SELECT half of the
// adapter. The heavy lifting — turning a query into SQL — belongs to the
// sibling packages: @yaks/query parses the query text into an AST, @yaks/vocab
// describes the vocabulary, and @yaks/sql compiles the two into a statement
// that selects the matching entities' ids. This file runs that statement, then
// gathers each matched entity's components into a bundle.
//
// `rows()` is the raw form: it returns the compiled statement's rows verbatim,
// which is what aggregate and projection queries (a count, a tally, a field
// list) want. `read()` is the whole-entity form built on it: it takes the ids
// `rows()` returns and reads back every component each entity has.

import { type And, parse } from '@yaks/query'
import type { Prop, Vocab } from '@yaks/vocab'
import {
  among,
  and,
  as,
  type Backings,
  type BindOpts,
  col,
  compile,
  cross,
  DEEP,
  type Derived,
  doomSql,
  type Driver,
  each,
  eidAt,
  eidOf,
  eq,
  exists,
  type Expr,
  from,
  idOf,
  type Join,
  join,
  left,
  lit,
  looseSql,
  narrow,
  type Query as Sub,
  type Raw,
  type Row,
  type Select,
  select,
  type Source,
  table,
  val,
} from '@yaks/sql'
import type { Bundle, Comp } from './bundle.ts'
import type { Doom, Gone } from '@yaks/graph'
import { sha256, tombstoned } from '@yaks/graph'
import { catalog, descriptor } from './catalog.ts'
import { unit } from './unit.ts'
import { decoded, jsonOut, projected } from './jsonb.ts'
import { tables } from './ddl.ts'

// A query, as text or as an already-built AST. Text is parsed; an AST passes
// through, so a caller may hand-build one with @yaks/query's builders.
export type Query = string | And

let ast = (q: Query): And => typeof q == 'string' ? parse(q) : q

// The raw compiled rows for a query — a membership query returns `{ eid }` per
// match, an aggregate returns its value/count shape, and a `.fields`
// projection's columns come back as a component read would return them. The
// values are bound as parameters.
export let rows = (
  driver: Driver,
  vocab: Vocab,
  query: Query,
  opts: BindOpts = {},
): Row[] => {
  let indexed = !!vocab.comp('archetype')
  let ask = () => {
    let s = compile(ast(query), vocab, {
      ...opts,
      archetypes: opts.archetypes ?? (indexed ? catalog(driver) : undefined),
    })
    return driver.query(s).map((r) => projected(vocab, r))
  }
  // The catalog and entity statement must see the same commit. Otherwise a
  // concurrent writer could introduce a new matching set between the two. A
  // read unit is one snapshot without the write lock, so a long query never
  // makes a writer on another connection wait (./unit.ts).
  return indexed || opts.archetypes ? unit(driver, ask, 'read') : ask()
}

// The properties a gather reads: the stored ones, plus any computed property
// the caller registered an expression for. A computed property has no row to
// read, so without a registration there is nothing to select — but with one it
// is a column like any other, and leaving it out of the bundle while the filter
// resolves it would make `.task.status=open` select rows whose `status` the
// result does not carry.
let read1 = (v: Vocab, comp: string, derived: Derived): Prop[] =>
  v.props(comp).map((p) => v.prop(comp, p)!)
    .filter((c) => !c.computed || derived[`${comp}.${c.prop}`])

// The projected read for one component: each scalar straight off the row, each
// reference joined back to its target's eid, each JSON value as its JSON text
// (./jsonb.ts, parsed by `decoded` once the row is back), keyed by the owner
// eid. A component with no properties reads a bare presence flag.
//
// A property whose read differs from its storage is read through its registered
// expression instead — the same `derived` registry @yaks/sql consults when it
// compiles a query (see @yaks/sql/derived.ts). That is what keeps the two
// readers agreeing: a value the filter resolves one way cannot come back
// gathered another. It is also where a content-addressed property is
// resolved — @yaks/blob registers one override per body property, and the
// gather returns the text rather than the address the row holds.
//
// So the component table is aliased by its own name here, exactly as the binder
// joins it, and an override's `deps` are left-joined the same way: a registered
// expression is written once and reads the same in both places.
//
// A reference to a computed component's entity (the journal's `_change.tx`)
// reads as that entity's eid, written out from the id it holds: such an
// entity has no row in the entity table to join (@yaks/sql `Backing`).
type Projection = { sel: Expr[]; joins: Join[] }
let projection = (
  v: Vocab,
  comp: string,
  derived: Derived,
  backed: Backings,
): Projection => {
  let own = (prop: string) => col(prop, comp)
  let sel: Expr[] = []
  let joins: Join[] = []
  let deps = new Set<string>()
  for (let c of read1(v, comp, derived)) {
    let over = derived[`${comp}.${c.prop}`]
    let tag = c.ref ? backed[c.ref]?.tag : undefined
    if (over) {
      for (let d of over.deps ?? []) deps.add(d)
      sel.push(as(over.expr(own('entity')), c.prop))
    } else if (tag) {
      sel.push(as(eidAt(tag, own(c.prop)), c.prop))
    } else if (c.category == 'ref') {
      let a = `r_${c.prop.replaceAll(/[^A-Za-z0-9]/g, '_')}`
      joins.push(left(table('entity', a), eq(col('id', a), own(c.prop))))
      sel.push(as(col('eid', a), c.prop))
    } else if (c.scalar == 'jsonb') {
      sel.push(as(jsonOut(own(c.prop)), c.prop))
    } else {
      sel.push(as(own(c.prop), c.prop))
    }
  }
  for (let d of deps) {
    if (d == comp) continue
    joins.push(left(table(d), eq(col('entity', d), own('entity'))))
  }
  return { sel, joins }
}

// What `key` holds in `m`, made on first ask.
let at = <K, V>(
  m: { get(k: K): V | undefined; set(k: K, v: V): unknown },
  key: K,
  make: () => V,
): V => {
  let v = m.get(key)
  if (v === undefined) m.set(key, v = make())
  return v
}

// A read's trees, kept per vocabulary and registries while they live. A store
// asks the same few reads thousands of times a session, and @yaks/sql renders
// a tree it has seen once, so only the part holding the ids is written again.
// The registries are built once per store and never changed.
let NONE = {}
let kept = new WeakMap<
  object,
  WeakMap<object, WeakMap<object, Map<string, Projection>>>
>()
let project = (
  v: Vocab,
  comp: string,
  derived: Derived = NONE,
  backed: Backings = NONE,
): Projection =>
  at(
    at(
      at(at(kept, v, () => new WeakMap()), derived, () => new WeakMap()),
      backed,
      () => new Map(),
    ),
    comp,
    () => projection(v, comp, derived, backed),
  )

// One component's read, whatever names its owners: `lead` is what is selected
// before the component's own columns, `owner` the condition on `o`, the
// owner's spine row.
let selectComp = (
  v: Vocab,
  comp: string,
  derived: Derived,
  lead: Expr[],
  owner: Expr,
): Select => {
  let { sel, joins } = project(v, comp, derived)
  return select({
    cols: [...lead, ...(sel.length ? sel : [as(lit(1), 'present')])],
    from: table(comp),
    joins: [
      join(table('entity', 'o'), eq(col('id', 'o'), col('entity', comp))),
      ...joins,
    ],
    where: owner,
  })
}

/**
 * The SELECT that reads one component of one entity, named by its eid.
 * Exported because gathering a bundle is every SQLite-shaped adapter's job,
 * and they must all read a property the same way: @yaks/d1 sends these
 * statements as one batch instead of one at a time, and nothing else differs.
 */
export let compSql = (
  v: Vocab,
  comp: string,
  eid: string,
  derived: Derived = {},
): Select => selectComp(v, comp, derived, [], eq(col('eid', 'o'), val(eid)))

/**
 * The column a set-shaped read keys its rows by. Not a component prop — a prop
 * is an identifier, so nothing in a vocabulary can collide with it.
 */
export let OWNER = '@eid'

/**
 * The same read widened from one entity to a set: every entity `owners` names,
 * each row carrying its owner's eid under {@link OWNER}. `owners` is a query
 * selecting one `eid` column.
 *
 * This is what makes a whole read one round trip over a remote database
 * (@yaks/d1 `wholeSql`): the hits are named by the query that found them
 * instead of by eids a first trip had to go and fetch.
 */
export let setSql = (
  v: Vocab,
  comp: string,
  owners: Sub,
  derived: Derived = {},
): Select =>
  selectComp(
    v,
    comp,
    derived,
    [as(col('eid', 'o'), OWNER)],
    among(col('eid', 'o'), owners),
  )

/**
 * The spine rows of the entities `which` names, as `e`: each one's id, eid,
 * number and grave, and its archetype's eid and table set where the store
 * keeps archetypes. What every whole read starts from.
 */
export let spine = (vocab: Vocab, which: Expr): Select => {
  let typed = !!vocab.comp('archetype')
  return select({
    cols: [
      col('id', 'e'),
      col('eid', 'e'),
      col('num', 'e'),
      as(col('entity', 't'), 'dead'),
      ...(typed
        ? [
          as(col('eid', 'a'), 'archetype'),
          as(col('tables', 'shape'), '@tables'),
        ]
        : []),
    ],
    from: table('entity', 'e'),
    joins: [
      ...(typed
        ? [
          left(table('entity', 'a'), eq(col('id', 'a'), col('archetype', 'e'))),
          left(
            table('archetype', 'shape'),
            eq(col('entity', 'shape'), col('archetype', 'e')),
          ),
        ]
        : []),
      left(table('tombstone', 't'), eq(col('entity', 't'), col('id', 'e'))),
    ],
    where: which,
  })
}

// Which tables hold a row for any owner. VALUES has no compound-SELECT arm
// limit, so a wide sparse vocabulary still takes one presence statement.
// Globally empty tables short-circuit before the owners are walked.
let worn = new WeakMap<Vocab, Map<string, Source>>()
let probe = (vocab: Vocab, names: string[], owners: number[]): Select =>
  select({
    with: [{ name: 'owners', q: each(owners), materialized: true }],
    cols: [as(col('column1', 'worn'), 'name')],
    from: at(
      at(worn, vocab, () => new Map()),
      `${owners.length > 1} ${names}`,
      () =>
        from({
          t: 'values',
          rows: names.map((c) => [
            lit(c),
            and(
              ...(owners.length > 1
                ? [exists(select({ cols: [lit(1)], from: table(c) }))]
                : []),
              exists(select({
                cols: [lit(1)],
                from: table('owners'),
                joins: [cross(table(c))],
                where: eq(col('entity', c), col('value', 'owners')),
              })),
            ),
          ]),
        }, 'worn'),
    ),
    where: eq(col('column2', 'worn'), lit(true)),
  })

/**
 * Identity, not search: these entities as they stand. A tombstoned one comes
 * back carrying `tombstone` (it is still an identity, just a deleted one); an
 * eid no entity has is simply absent. Each carries the components `comps`
 * names, and no other table is read; left out, it carries every one. This is
 * the read `apply()` uses for its precondition guard, where a query would be
 * the wrong question.
 */
export let get = (
  driver: Driver,
  vocab: Vocab,
  eids: string[],
  opts: BindOpts = {},
  comps?: string[],
): Bundle[] => {
  // The tables this read may touch: every component's, or the named ones'.
  let names = tables(vocab).filter((c) => !comps || comps.includes(c))
  let asked = new Set(names)
  let found = new Map<string, Bundle>()
  // Whether a number is this store's to show. The spine table holds the column
  // in every layout, but the number is @yaks/id's word and a store that never
  // loaded it has none to speak of — including one that was numbered before the
  // plugin was opt in, whose old rows still carry the value. Read off the
  // vocabulary, the way the archetype below is.
  let numbered = !!vocab.prop('entity', 'num')
  // Bound parameter count and SQL-cache size; gather a component per set,
  // never every component per entity (a 1,000-entry transcript is otherwise
  // tens of thousands of queries). A JSON array uses one bind and one stable
  // prepared statement shape regardless of cardinality (SQLite 3.38+).
  // Materialize the selected ids once: re-running a window subquery
  // for each component could select different owners under a concurrent writer.
  // Keep caller order and duplicate semantics.
  for (let i = 0; i < eids.length; i += 4096) {
    let ids = eids.slice(i, i + 4096)
    let owners: number[] = []
    let byId = new Map<number, Bundle>()
    let groups = new Map<string, number[]>()
    for (
      let row of driver.query(spine(vocab, among(col('eid', 'e'), each(ids))))
    ) {
      let eid = String(row.eid)
      let entity = {
        eid,
        ...!numbered || row.num == null ? {} : { num: Number(row.num) },
        ...(row.archetype == null ? {} : { archetype: String(row.archetype) }),
      }
      let bundle = row.dead == null ? { entity } : tombstoned(entity)
      found.set(eid, bundle)
      byId.set(Number(row.id), bundle)
      if (row.dead != null) continue
      if (row['@tables'] == null) {
        owners.push(Number(row.id))
      } else {
        let key = String(row['@tables'])
        let group = groups.get(key)
        if (!group) groups.set(key, group = [])
        group.push(Number(row.id))
      }
    }
    let compOwners = new Map<string, number[]>()
    // Group once per archetype, then read each present table once across all
    // its owner groups. No component-table census on classified entities.
    for (let [text, group] of groups) {
      for (let comp of descriptor(driver, text).tables) {
        if (!asked.has(comp)) continue
        let held = compOwners.get(comp)
        if (held) held.push(...group)
        else compOwners.set(comp, [...group])
      }
    }
    // Unclassified rows have no descriptor. Probe their worn tables once;
    // a named component read can ask those tables directly. The live probe
    // sees a component added or removed by another writer on the next read.
    let present: string[] = comps && owners.length ? names : []
    if (!comps && owners.length && names.length) {
      present.push(
        ...driver.query(probe(vocab, names, owners))
          .map((r) => String(r.name)),
      )
    }
    for (let comp of present) {
      let held = compOwners.get(comp)
      if (held) held.push(...owners)
      else compOwners.set(comp, owners)
    }
    for (let [comp, ids] of compOwners) {
      // The spine pass already resolved every owner's storage id. Do not join
      // it again for each component just to recover the eid we already hold.
      // References still use project()'s joins; only ownership stays numeric.
      let { sel, joins } = project(vocab, comp, opts.derived, opts.backed)
      for (
        let row of driver.query(select({
          cols: [as(col('entity', comp), '@id'), ...sel],
          from: table(comp),
          joins,
          where: among(col('entity', comp), each(ids)),
        }))
      ) {
        let { '@id': owner, ...value } = row
        let b = byId.get(Number(owner))!
        if ('tombstone' in b) continue
        b[comp] = decoded(vocab, comp, value) as Comp
      }
    }
  }
  backedGet(driver, vocab, eids.filter((e) => !found.has(e)), opts, comps)
    .forEach((b) => found.set(b.entity.eid, b))
  return eids.flatMap((eid) => found.has(eid) ? [found.get(eid)!] : [])
}

// The entities a computed component's rows hold, among eids the entity table
// does not: each backing's own, read back out of the eid and gathered from its
// rows (@yaks/sql `Backing`). An eid no backing's tag names is left out, as an
// unknown one is; one whose row is gone is absent too.
let backedGet = (
  driver: Driver,
  vocab: Vocab,
  eids: string[],
  opts: BindOpts,
  comps?: string[],
): Bundle[] =>
  Object.entries(opts.backed ?? {}).flatMap(([comp, b]) => {
    let tag = b.tag
    let ids = tag
      ? eids.map((e) => idOf(tag, e)).filter((id) => id != null)
      : []
    if (!tag || !ids.length) return []
    let { sel, joins } = project(vocab, comp, opts.derived, opts.backed)
    let asked = !comps || comps.includes(comp)
    return driver.query(select({
      cols: [as(col('entity', comp), '@id'), ...sel],
      from: from(b.rows, comp),
      joins,
      where: among(col('entity', comp), each(ids)),
    })).map(({ '@id': id, ...value }): Bundle => ({
      entity: { eid: eidOf(tag, Number(id)) },
      ...asked ? { [comp]: decoded(vocab, comp, value) as Comp } : {},
    }))
  })

/** The tag a computed component's eids end with in a store: the store's epoch
 * and the component, hashed (@yaks/sql `eidOf`) — so a record's eid names it
 * in this store and no other. */
export let tagOf = (epoch: string, comp: string): string =>
  sha256(`${epoch}|${comp}`).slice(0, 32)

/**
 * The whole death cascade, computed by one statement rather than walked:
 * everything that dies with these entities, and every soft reference that has
 * to let go of them (@yaks/sql's `doomSql`/`looseSql`). @yaks/graph would
 * otherwise read once per rung of the chain — free here, a round trip each over
 * a network — and that walk is what an adapter unable to compile this still
 * gets.
 *
 * A vocabulary too wide for one statement (@yaks/sql `narrow`) is queried in
 * rounds: each statement is transitive within its own tables, so the result
 * is complete when a round turns up nothing the last one had not.
 *
 * Asked inside the transaction, after the batch's patches have gone in, which
 * is what makes the result the one the cascade wants: who points at the dying
 * as the batch leaves the graph.
 */
export let doom = (driver: Driver, vocab: Vocab, eids: string[]): Doom => {
  let ask = (s: Raw) => driver.query(s)
  let depth = new Map<string, number>()
  let gone: Gone[] = []
  let seed = eids
  let base = 0
  for (;;) {
    let fresh: string[] = []
    let least = DEEP
    for (let s of doomSql(vocab, seed)) {
      for (let r of ask(s)) {
        let eid = String(r.eid)
        if (depth.has(eid)) continue
        let rung = base + Number(r.depth)
        depth.set(eid, rung)
        gone.push({ eid, depth: rung })
        fresh.push(eid)
        least = Math.min(least, rung)
      }
    }
    if (narrow(vocab) || !fresh.length) break
    seed = fresh
    base = least
  }
  return {
    gone,
    loose: looseSql(vocab, [...depth.keys()]).flatMap((s) =>
      ask(s).map((r) => ({
        eid: String(r.eid),
        comp: String(r.comp),
        prop: String(r.prop),
      }))
    ),
  }
}

// The matched entities, with only `comps` when named. A membership query
// returns entities; an aggregate query wants `rows()` instead.
export let read = (
  driver: Driver,
  vocab: Vocab,
  query: Query,
  opts: BindOpts = {},
  comps?: string[],
): Bundle[] =>
  get(
    driver,
    vocab,
    rows(driver, vocab, query, opts)
      .filter((r) => r.eid != null).map((r) => String(r.eid)),
    opts,
    comps,
  )
