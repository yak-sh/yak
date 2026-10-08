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
// `screened()` is the statement alone, for a search beside the graph to run.

import { field } from '@yaks/sql'
import { type And, map, parse } from '@yaks/query'
import type { Prop, Vocab } from '@yaks/vocab'
import {
  among,
  and,
  ARMS,
  as,
  type Backings,
  type BindOpts,
  call,
  col,
  compile,
  cross,
  DEEP,
  type Derived,
  derivedOf,
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
  render,
  revision,
  type Row,
  screen,
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

export let ast = (q: Query): And => typeof q == 'string' ? parse(q) : q

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
  let ask = () =>
    driver.query(compile(ast(query), vocab, catalogued(driver, vocab, opts)))
      .map((r) => projected(vocab, r))
  // The catalog and entity statement must see the same commit. Otherwise a
  // concurrent writer could introduce a new matching set between the two. A
  // read unit is one snapshot without the write lock, so a long query never
  // makes a writer on another connection wait (./unit.ts).
  return indexed || opts.archetypes ? unit(driver, ask, 'read') : ask()
}

// A compile's options over this file: the caller's, and the file's archetype
// catalog where the vocabulary keeps one, so every presence and kind test is
// a lookup on the archetype index.
let catalogued = (driver: Driver, vocab: Vocab, opts: BindOpts): BindOpts => ({
  ...opts,
  archetypes: opts.archetypes ??
    (vocab.comp('archetype') ? catalog(driver) : undefined),
})

/**
 * The entities a query admits, as a statement selecting their integer ids as
 * `id` (@yaks/sql `screen`), compiled as this file's reads are: what a search
 * run beside the graph is narrowed by. It names the archetypes that match now,
 * so run it before anything else writes.
 */
export let screened = (
  driver: Driver,
  vocab: Vocab,
  query: Query,
  opts: BindOpts = {},
): Raw | null => screen(ast(query), vocab, catalogued(driver, vocab, opts))

// The properties a gather reads: the stored ones, plus any computed property
// the caller registered an expression for. A computed property has no row to
// read, so without a registration there is nothing to select — but with one it
// is a column like any other, and leaving it out of the bundle while the filter
// resolves it would make `.task.status=open` select rows whose `status` the
// result does not carry.
let read1 = (v: Vocab, comp: string, derived: Derived): Prop[] =>
  v.props(comp).map((p) => v.prop(comp, p)!)
    .filter((c) =>
      (!c.computed || derived[`${comp}.${c.prop}`]) &&
      derived[`${comp}.${c.prop}`]?.whole !== false
    )

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
//
// Read `named`, a reference reads as the id it holds instead, listed in
// `refs`: a set read names every id it found in one statement afterwards
// (`naming`), rather than joining the entity table once per row for an eid
// that most rows share.
type Projection = { sel: Expr[]; joins: Join[]; refs?: string[] }
let projection = (
  v: Vocab,
  comp: string,
  derived: Derived,
  backed: Backings,
  named = false,
): Projection => {
  let own = (prop: string) => col(prop, comp)
  let sel: Expr[] = []
  let joins: Join[] = []
  let refs: string[] = []
  let deps = new Set<string>()
  for (let c of read1(v, comp, derived)) {
    let over = derived[`${comp}.${c.prop}`]
    let tag = c.ref ? backed[c.ref]?.tag : undefined
    if (over) {
      for (let d of over.deps ?? []) deps.add(d)
      sel.push(as(over.expr(own('entity')), c.prop))
    } else if (tag) {
      sel.push(as(eidAt(tag, own(field(c.prop))), c.prop))
    } else if (c.category == 'ref' && named) {
      refs.push(c.prop)
      sel.push(as(own(field(c.prop)), c.prop))
    } else if (c.category == 'ref') {
      let a = `r_${c.prop.replaceAll(/[^A-Za-z0-9]/g, '_')}`
      joins.push(left(table('entity', a), eq(col('id', a), own(field(c.prop)))))
      sel.push(as(col('eid', a), c.prop))
    } else if (c.scalar == 'jsonb') {
      sel.push(as(jsonOut(own(field(c.prop))), c.prop))
    } else {
      sel.push(as(own(field(c.prop)), c.prop))
    }
  }
  for (let d of deps) {
    if (d == comp) continue
    joins.push(left(table(d), eq(col('entity', d), own('entity'))))
  }
  return { sel, joins, ...refs.length ? { refs } : {} }
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
// A status a vocabulary's ladder computes is read like any registered one
// (@yaks/sql `derivedOf`).
let project = (
  v: Vocab,
  comp: string,
  derived: Derived = NONE,
  backed: Backings = NONE,
  named = false,
): Projection => {
  let all = derivedOf(v, derived)
  return at(
    at(
      at(at(kept, v, () => new WeakMap()), all, () => new WeakMap()),
      backed,
      () => new Map(),
    ),
    `${named} ${comp}`,
    () => projection(v, comp, all, backed, named),
  )
}

// The eids of the entities these ids are, in one statement: what a set read
// asks once for every reference its rows hold. An id no entity has stays
// unnamed, as a reference whose target is gone reads.
let naming = (driver: Driver, ids: Iterable<unknown>): Map<number, string> => {
  let asked = [
    ...new Set([...ids].flatMap((id) => id == null ? [] : [Number(id)])),
  ]
  if (!asked.length) return new Map()
  return new Map(
    driver.query(select({
      cols: [col('id', 'e'), col('eid', 'e')],
      from: ownerSet(asked),
      joins: [cross(table('entity', 'e'))],
      where: eq(col('id', 'e'), col('value', '@owners')),
    })).map((r) => [Number(r.id), String(r.eid)]),
  )
}
// A row's references, named.
let named = (
  value: Row,
  refs: string[] | undefined,
  names: Map<number, string>,
): Row => {
  if (!refs) return value
  let out = { ...value }
  for (let prop of refs) {
    out[prop] = out[prop] == null ? null : names.get(Number(out[prop])) ?? null
  }
  return out
}

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
// Remote adapters already explicitly plan their component projections. Keep
// their established gather contract; SQLite's own get/read uses the opted-out
// projection above. An adapter can opt in through the property registry.
let complete = new WeakMap<Derived, Derived>()
let completeDerived = (derived: Derived): Derived =>
  at(complete, derived, () => ({
    ...derived,
    ...Object.fromEntries(
      Object.entries(derived).filter(([, d]) => d.whole === false).map((
        [p, d],
      ) => [p, { ...d, whole: true }]),
    ),
  }))

export let compSql = (
  v: Vocab,
  comp: string,
  eid: string,
  derived: Derived = {},
): Select =>
  selectComp(
    v,
    comp,
    completeDerived(derived),
    [],
    eq(col('eid', 'o'), val(eid)),
  )

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
    completeDerived(derived),
    [as(col('eid', 'o'), OWNER)],
    among(col('eid', 'o'), owners),
  )

/**
 * The spine rows of the entities `which` names, as `e`: each one's id, eid,
 * number and grave, and its archetype's eid and table set where the store
 * keeps archetypes. What every whole read starts from. Left `kind`-only, it
 * carries the archetype as the id the entity points at (`@kind`), for a reader
 * that knows the descriptors already (`kinded`).
 */
export let spine = (vocab: Vocab, which: Expr, kind = false): Select => {
  let typed = !!vocab.comp('archetype')
  return select({
    cols: [
      col('id', 'e'),
      col('eid', 'e'),
      col('num', 'e'),
      as(col('entity', 't'), 'dead'),
      ...(!typed ? [] : kind ? [as(col('archetype', 'e'), '@kind')] : [
        as(col('eid', 'a'), 'archetype'),
        as(col('tables', 'shape'), '@tables'),
      ]),
    ],
    from: table('entity', 'e'),
    joins: [
      ...(typed && !kind
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

// Drive identity reads from the requested set. SQLite estimates json_each at
// a fixed cardinality; an IN subquery can therefore choose a table scan when
// statistics remember a small component (even after its history grows). CROSS
// JOIN keeps the requested owners outside the indexed spine/component probes.
let ownerSet = (ids: readonly (string | number)[]): Source =>
  call('json_each', [val(JSON.stringify(ids))], '@owners')
let namedSpine = (vocab: Vocab, eids: string[]): Select => {
  let base = spine(vocab, eq(col('eid', 'e'), col('value', '@owners')), true)
  return select({
    ...base,
    from: ownerSet(eids),
    joins: [cross(table('entity', 'e')), ...base.joins!],
  })
}

// An archetype's eid and tables never change once its row stands, and a store
// holds a few dozen, so a read keeps them per connection rather than joining
// both into every entity it reads. A new descriptor, a deleted entity or a
// rollback starts the keeping over (@yaks/sql `revision`).
let kinds = new WeakMap<Driver, { at: number; held: Map<number, Row> }>()
let kinded = (driver: Driver, vocab: Vocab, rows: Row[]): Row[] => {
  if (!vocab.comp('archetype')) return rows
  let at = revision(driver, 'descriptors')
  let cache = kinds.get(driver)
  if (cache?.at != at) kinds.set(driver, cache = { at, held: new Map() })
  let { held } = cache
  let missing = [
    ...new Set(
      rows.flatMap((r) =>
        r['@kind'] == null || held.has(Number(r['@kind']))
          ? []
          : [Number(r['@kind'])]
      ),
    ),
  ]
  if (missing.length) {
    let found = driver.query(select({
      cols: [col('id', 'e'), col('eid', 'e'), col('tables', 'a')],
      from: ownerSet(missing),
      joins: [
        cross(table('entity', 'e')),
        left(table('archetype', 'a'), eq(col('entity', 'a'), col('id', 'e'))),
      ],
      where: eq(col('id', 'e'), col('value', '@owners')),
    }))
    for (let row of found) held.set(Number(row.id), row)
  }
  for (let row of rows) {
    let kind = row['@kind'] == null ? undefined : held.get(Number(row['@kind']))
    row.archetype = kind?.eid ?? null
    row['@tables'] = kind?.tables ?? null
  }
  return rows
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

// A previous table set is only a guess about which read to prepare. The read
// always fetches the current spine, descriptor and component values together;
// a descriptor that names another table sends it through the ordinary gather.
let shapes = new WeakMap<
  Driver,
  WeakMap<Vocab, Map<string, readonly string[]>>
>()
let stored = new WeakMap<Vocab, Set<string>>()
let readable = (vocab: Vocab) => at(stored, vocab, () => new Set(tables(vocab)))
type Joined = { statement: Raw; names: string[]; props: string[][] }
let joined = new WeakMap<
  Vocab,
  WeakMap<object, WeakMap<object, Map<string, Joined | null>>>
>()
let bounded = <K, V>(cache: Map<K, V>, key: K, value: V, limit: number) => {
  if (cache.size >= limit && !cache.has(key)) {
    cache.delete(cache.keys().next().value!)
  }
  cache.set(key, value)
  return value
}

// Each facet's references and derived dependencies have their own scope.
// Inline joins retain indexed owner probes; a LEFT JOIN over a subquery with
// its own joins would make SQLite materialize that facet's entire table.
let scoped = (
  p: Projection,
  name: string,
  prefix: string,
): Projection | null => {
  let aliases = new Map([[name, prefix]])
  for (let j of p.joins) {
    if (j.src.t != 'table') return null
    let alias = j.src.as ?? j.src.name
    aliases.set(alias, `${prefix}:${alias}`)
  }
  let raw = false
  let rename = (node: unknown): unknown => {
    if (!node || typeof node != 'object') return node
    if (Array.isArray(node)) return node.map(rename)
    let value = node as Record<string, unknown>
    // Bound/literal values are data, not SQL trees. A lowered fragment cannot
    // have its identifiers renamed, so it retains the ordinary gather.
    if (value.t == 'val' || value.t == 'lit') return node
    if (value.t == 'raw') {
      raw = true
      return node
    }
    if (value.t == 'col') {
      return { ...value, of: aliases.get(String(value.of)) ?? value.of }
    }
    if (value.t == 'table') {
      return {
        ...value,
        as: aliases.get(String(value.as ?? value.name)) ?? value.as,
      }
    }
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, rename(v)]),
    )
  }
  let out = rename(p) as Projection
  return raw ? null : out
}

let joinedPlan = (
  vocab: Vocab,
  names: string[],
  opts: BindOpts,
): Joined | null => {
  let cache = at(
    at(
      at(joined, vocab, () => new WeakMap()),
      opts.derived ?? NONE,
      () => new WeakMap(),
    ),
    opts.backed ?? NONE,
    () => new Map(),
  )
  let key = JSON.stringify(names)
  if (cache.has(key)) return cache.get(key)!
  let base = namedSpine(vocab, [])
  let columns = [...base.cols!]
  let joins = [...base.joins!]
  let props: string[][] = []
  let width = columns.length, breadth = joins.length + 1
  for (let [i, name] of names.entries()) {
    let alias = `@g${i}`
    let p = scoped(project(vocab, name, opts.derived, opts.backed), name, alias)
    if (!p) return bounded(cache, key, null, 128)
    let fields = p.sel.map((e) => {
      if (e.t != 'as' && e.t != 'col') {
        throw Error('a projected property needs a name')
      }
      return e.name
    })
    props.push(fields)
    width += fields.length + 1
    breadth += p.joins.length + 1
    // The outer read and every nested projection fit workerd's column and
    // SQLite's joined-table limits. Wide entities keep the set-shaped gather.
    if (width > 100 || breadth > 60 || fields.length + 1 > 100) {
      return bounded(cache, key, null, 128)
    }
    joins.push(
      left(table(name, alias), eq(col('entity', alias), col('id', 'e'))),
      ...p.joins,
    )
    columns.push(as(col('entity', alias), `@${i}`))
    for (let [j, prop] of fields.entries()) {
      let expr = p.sel[j]
      columns.push(as(expr.t == 'as' ? expr.e : expr, `@${i}.${prop}`))
    }
  }
  let statement = render(select({ ...base, cols: columns, joins }))
  if (statement.sql.length > 90_000 || statement.params.length > 100) {
    return bounded(cache, key, null, 128)
  }
  return bounded(cache, key, { statement, names, props }, 128)
}

let joinedGet = (
  driver: Driver,
  vocab: Vocab,
  eids: string[],
  opts: BindOpts,
  names: string[],
  wanted?: string[],
  pending: Set<string> = new Set(),
): Bundle[] | { spine: Row[] } | undefined => {
  let plan = joinedPlan(vocab, names, opts)
  if (!plan) return
  // The owners' JSON array is the final bind: projection expressions come
  // before FROM and the following spine/reference joins bind no parameters.
  let rows: Row[]
  try {
    rows = kinded(
      driver,
      vocab,
      driver.query({
        ...plan.statement,
        params: [...plan.statement.params.slice(0, -1), JSON.stringify(eids)],
      }),
    )
  } catch (err) {
    // A raw schema edit can remove a table from the previous shape. Read the
    // current descriptor before deciding which remaining tables to gather.
    if (err instanceof Error && /no such (table|column):/i.test(err.message)) {
      return
    }
    throw err
  }
  let found = new Map<string, Bundle>()
  let numbered = !!vocab.prop('entity', 'num')
  let covered = new Set(names)
  for (let row of rows) {
    let entity = {
      eid: String(row.eid),
      ...!numbered || row.num == null ? {} : { num: Number(row.num) },
      ...row.archetype == null ? {} : { archetype: String(row.archetype) },
    }
    let bundle: Bundle = row.dead == null ? { entity } : tombstoned(entity)
    found.set(entity.eid, bundle)
    if (row.dead != null) continue
    let current = row['@tables'] == null || pending.has(entity.eid)
      ? undefined
      : descriptor(driver, String(row['@tables'])).tables
    if (
      wanted == null &&
      (!current ||
        current.some((name) => readable(vocab).has(name) && !covered.has(name)))
    ) return { spine: rows }
    for (let [i, name] of names.entries()) {
      if (row[`@${i}`] == null || current && !current.includes(name)) continue
      let values = Object.fromEntries(
        plan.props[i].map((prop) => [prop, row[`@${i}.${prop}`]]),
      )
      bundle[name] = decoded(vocab, name, values) as Comp
    }
  }
  backedGet(
    driver,
    vocab,
    eids.filter((eid) => !found.has(eid)),
    opts,
    wanted,
  )
    .forEach((b) => found.set(b.entity.eid, b))
  return eids.flatMap((eid) => found.get(eid) ?? [])
}

/**
 * Identity, not search: these entities as they stand. A tombstoned one comes
 * back carrying `tombstone` (it is still an identity, just a deleted one); an
 * eid no entity has is simply absent. Each carries the components `comps`
 * names, and no other table is read; left out, it carries every one. This is
 * the read `apply()` uses for its precondition guard, where a query would be
 * the wrong question. `unclassified` names entities whose component rows moved
 * inside the transaction before their archetype pointer was assigned; these
 * are gathered from their physical rows rather than the stored descriptor.
 */
export let get = (
  driver: Driver,
  vocab: Vocab,
  eids: string[],
  opts: BindOpts = {},
  comps?: string[],
  unclassified: string[] = [],
): Bundle[] => {
  let pending = new Set(unclassified)
  // The tables this read may touch: every component's, or the named ones'.
  let names = comps
    ? [...new Set(comps)].filter((c) => readable(vocab).has(c))
    : tables(vocab)
  let remembered = at(
    at(shapes, driver, () => new WeakMap()),
    vocab,
    () => new Map(),
  )
  let initial: Row[] | undefined
  // Small, repeated identity reads benefit from one statement. Large gathers
  // still read each worn table once for all its owners, rather than joining
  // the union of every different entity's facets.
  if (
    eids.length && eids.length <= 32 && !comps && !pending.size &&
    eids.every((eid) => remembered.has(eid))
  ) {
    let descriptors = eids.filter((eid) => {
      let names = remembered.get(eid)!
      return names.length == 1 && names[0] == 'archetype'
    })
    if (descriptors.length && descriptors.length < eids.length) {
      let owners = eids.filter((eid) => !descriptors.includes(eid))
      let a = joinedGet(
        driver,
        vocab,
        descriptors,
        opts,
        ['archetype'],
        undefined,
        pending,
      )
      let names = [
        ...new Set(owners.flatMap((eid) => [...remembered.get(eid)!])),
      ].sort()
      let b = joinedGet(driver, vocab, owners, opts, names, undefined, pending)
      if (Array.isArray(a) && Array.isArray(b)) {
        let at = new Map([...a, ...b].map((row) => [row.entity.eid, row]))
        return eids.flatMap((eid) => at.get(eid) ?? [])
      }
    }
  }
  if (eids.length && eids.length <= 32) {
    let guess = comps
      ? names
      : eids.every((eid) => remembered.has(eid))
      ? [...new Set(eids.flatMap((eid) => [...remembered.get(eid)!]))].sort()
      : undefined
    if (guess) {
      let rows = joinedGet(driver, vocab, eids, opts, guess, comps, pending)
      if (Array.isArray(rows)) return rows
      initial = rows?.spine
    }
  }
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
      let row of initial ??
        kinded(driver, vocab, driver.query(namedSpine(vocab, ids)))
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
      if (row.dead != null) {
        bounded(remembered, eid, [], 2048)
        continue
      }
      if (row['@tables'] == null || pending.has(eid)) {
        owners.push(Number(row.id))
      } else {
        let key = String(row['@tables'])
        bounded(
          remembered,
          eid,
          descriptor(driver, key).tables.filter((c) => names.includes(c)),
          2048,
        )
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
    // The spine pass already resolved every owner's storage id. Do not join
    // it again for each component just to recover the eid we already hold;
    // the references every component's rows hold are named once, together.
    let read: [Bundle, string, Row, string[] | undefined][] = []
    for (let [comp, ids] of compOwners) {
      let { sel, joins, refs } = project(
        vocab,
        comp,
        opts.derived,
        opts.backed,
        true,
      )
      for (
        let row of driver.query(select({
          cols: [as(col('entity', comp), '@id'), ...sel],
          from: ownerSet(ids),
          joins: [cross(table(comp)), ...joins],
          where: eq(col('entity', comp), col('value', '@owners')),
        }))
      ) {
        let { '@id': owner, ...value } = row
        let b = byId.get(Number(owner))!
        if ('tombstone' in b) continue
        read.push([b, comp, value, refs])
      }
    }
    let refNames = naming(
      driver,
      read.flatMap(([, , value, refs]) => refs?.map((p) => value[p]) ?? []),
    )
    for (let [b, comp, value, refs] of read) {
      b[comp] = decoded(vocab, comp, named(value, refs, refNames)) as Comp
    }
  }
  backedGet(driver, vocab, eids.filter((e) => !found.has(e)), opts, comps)
    .forEach((b) => found.set(b.entity.eid, b))
  for (let eid of eids) {
    if (!found.has(eid)) bounded(remembered, eid, [], 2048)
  }
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
 * A statement carries as many terms as the driver says its engine allows
 * (@yaks/sql `Driver.arms`), so an embedded SQLite asks the whole cascade at
 * once. A vocabulary too wide for one statement (@yaks/sql `narrow`) is
 * queried in rounds: each statement is transitive within its own tables, so
 * the result is complete when a round turns up nothing the last one had not.
 *
 * Asked inside the transaction, after the batch's patches have gone in, which
 * is what makes the result the one the cascade wants: who points at the dying
 * as the batch leaves the graph.
 */
export let doom = (driver: Driver, vocab: Vocab, eids: string[]): Doom => {
  let ask = (s: Raw) => driver.query(s)
  let terms = driver.arms ?? ARMS
  let depth = new Map<string, number>()
  let gone: Gone[] = []
  let seed = eids
  let base = 0
  for (;;) {
    let fresh: string[] = []
    let least = DEEP
    for (let s of doomSql(vocab, seed, terms)) {
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
    if (narrow(vocab, terms) || !fresh.length) break
    seed = fresh
    base = least
  }
  return {
    gone,
    loose: looseSql(vocab, [...depth.keys()], terms).flatMap((s) =>
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
// An explicit property query opts into a derived value omitted by a whole
// gather. Registries keep their identity so the projection caches still hit.
let explicit = new WeakMap<Derived, Map<string, Derived>>()
let requestedDerived = (query: And, derived: Derived): Derived => {
  let wanted = new Set<string>()
  let path = (segments: string[]) => {
    let key = segments.join('.')
    if (derived[key]?.whole === false) wanted.add(key)
  }
  map(query, (clause) => {
    if ('path' in clause) path(clause.path)
    if (clause.kind == 'order') path(clause.value.replace(/^-/, '').split('.'))
    if (clause.kind == 'fields') clause.fields.forEach((f) => path(f.path))
    return clause
  })
  if (!wanted.size) return derived
  let key = [...wanted].sort().join(',')
  let cache = at(explicit, derived, () => new Map())
  return at(cache, key, () => ({
    ...derived,
    ...Object.fromEntries(
      [...wanted].map((p) => [p, { ...derived[p], whole: true }]),
    ),
  }))
}

export let read = (
  driver: Driver,
  vocab: Vocab,
  query: Query,
  opts: BindOpts = {},
  comps?: string[],
  ask: (query: And) => Row[] = (q) => rows(driver, vocab, q, opts),
  fetch?: (eids: string[], comps?: string[]) => Bundle[],
): Bundle[] => {
  let parsed = ast(query)
  let eids = ask(parsed).filter((r) => r.eid != null).map((r) => String(r.eid))
  let derived = opts.derived ?? NONE, asked = requestedDerived(parsed, derived)
  // A query asking for no derived value a whole read leaves out reads its
  // entities as the store's own get does, through `fetch` where one is given.
  return fetch && asked == derived
    ? fetch(eids, comps)
    : get(driver, vocab, eids, { ...opts, derived: asked }, comps)
}
