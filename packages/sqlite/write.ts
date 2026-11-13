// Writes: bundles patched into the store, and entities removed from it. This
// is the PATCH half of the adapter — the mirror image of the reads in
// ./read.ts — and it honors the rules a graph patch honors everywhere:
//
//   omitted properties are untouched    a patch names only what changes
//   a property set to null is cleared   component reads omit the property
//   a component set to null is dropped  the row goes, the entity stays
//   a tombstoned entity takes no patch  until `revive` clears its tombstone;
//                                        it keeps its eid and number
//
// Every write here is a statement (an @yaks/sql `Write`), built before it is
// sent, and every statement is self-sufficient: an owner id is a subquery
// (`select id from entity where eid = ?`) rather than a value looked up first,
// and an insert whose owner does not exist writes nothing instead of inventing
// a row. Nothing is read between two writes.
//
// That is what lets one write path serve every SQLite-shaped adapter. An
// embedded engine could afford to query mid-write — look up an id, insert a
// row, query again — but D1 runs over the network and gives no interactive
// transaction, so a write that queried mid-flight could not be atomic there:
// whatever it learned would be learned outside the batch that commits.
// Statements that query nothing can be gathered into one list and sent as a
// single all-or-nothing unit, which is exactly what @yaks/d1 does with the ones
// built here.
//
// The one read that remains is about identity, not about ids: which of the
// named eids are already tombstoned, queried once for the whole batch. What
// numbers the new ones were given is not queried at all — every mint statement
// returns its own row, so an insert that minted returns one and an insert that
// found the eid already there returns none. That is why @yaks/d1 can mint
// without knowing a number in advance: its batch comes back statement by
// statement, and the numbers are in it.
//
// What is NOT here is which entities a delete takes with it. A reference's
// declared death behavior (`cascade`, `detach`, `release`, `keep`) is a rule
// about meaning, declared in the vocabulary, and @yaks/graph reads it — through
// the same transaction — to decide which entities go. This file removes exactly
// the entities it is given. One decision, in one place, shared by every storage
// adapter.
//
// Identity is storage's: `patch` mints a spine for every eid the batch touches
// or points at (so a reference may name a target created in the same batch, in
// any order), numbers each new one, and reports the entities it minted.

import { field, revision } from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import type { Bundle, Comp, Entity } from '@yaks/graph'
import { comps, TOMBSTONE } from '@yaks/graph/bundle'
import { stood } from './raise.ts'
import { Refused } from '@yaks/graph/errors'
import {
  meeting,
  type Pair,
  renumbering,
  type Series,
  seriesOf,
  stating,
} from '@yaks/graph/storage'
import {
  among,
  and,
  array,
  as,
  call,
  cell,
  col,
  cross,
  type Delete,
  type Driver,
  each,
  effect,
  eq,
  exists,
  type Expr,
  fn,
  from,
  gt,
  type Insert,
  isNull,
  jsonable,
  le,
  lit,
  not,
  notNull,
  oneOf,
  op,
  or,
  type Param,
  parts,
  type Row,
  select,
  sub,
  table,
  type Update,
  val,
  type Write,
} from '@yaks/sql'
import { tables } from './layout.ts'
import { required, sole } from './physical.ts'
import { heldBy } from './archetype.ts'
import { classed, spined } from './memo.ts'
import { isJsonb, jsonb, jsonIn } from './jsonb.ts'
import { described, get, grave, type Unsettled } from './read.ts'
import { kept } from './history.ts'

// The owner's integer id, as a subquery. Every write keys to it, so an entity
// minted earlier in the same unit of work resolves without a second question.
let owner = (eid: string): Expr =>
  sub(select({
    cols: [col('id')],
    from: table('entity'),
    where: eq(col('eid'), val(eid)),
  }))

// The sequence's high-water mark, and the next number past it.
let high: Expr = sub(select({
  cols: [col('high')],
  from: table('entity_sequence'),
  where: eq(col('singleton'), lit(1)),
}))
let next: Expr = sub(select({
  cols: [op('+', col('high'), lit(1))],
  from: table('entity_sequence'),
  where: eq(col('singleton'), lit(1)),
}))

// The value a column stores, coerced to what SQLite holds: a boolean becomes
// 0/1 (a bool column has integer affinity), everything else passes through. A
// reference is resolved to its target's integer id by the statement itself.
let scalar = (value: unknown): Param =>
  typeof value == 'boolean' ? Number(value) : value as Param

// Whether a property is a reference — asked of the vocabulary, which knows a
// property's category.
let isRef = (v: Vocab, comp: string, prop: string): boolean =>
  v.prop(comp, prop)?.category == 'ref'

// One property's value as what writes it: a reference names its target's eid
// and the statement looks up the id, a JSON value goes in through `jsonb()`
// (./jsonb.ts), and a scalar is bound as it is.
type Resolve = (eid: string) => Expr
let slot = (
  v: Vocab,
  comp: string,
  prop: string,
  raw: unknown,
  resolve: Resolve = owner,
): Expr =>
  raw != null && isRef(v, comp, prop)
    ? resolve(String(raw))
    : isJsonb(v, comp, prop)
    ? jsonb(val(jsonIn(raw)))
    : val(scalar(raw))

/** What the store already knows about an eid: its number and the prefix of
 * its series, and whether that identity is tombstoned. An eid with no entry
 * has no entity yet. */
export type Spine = {
  id: number
  num: number | null
  prefix?: string | null
  dead: boolean
}

/** What the store knows about these eids — one statement and one bound
 * parameter, whatever the batch's size (a Durable Object binds at most 100).
 * An eid absent from the map has no entity; one present with `dead` is
 * tombstoned, and a deleted identity is still an identity: it resolves by eid,
 * and `revive` brings it back. */
export let spines = (
  driver: Driver,
  eids: string[],
): Map<string, Spine> =>
  eids.length
    ? spined(driver).get(eids, (eids) => stored(driver, eids))
    : new Map()

let stored = (driver: Driver, eids: string[]): Map<string, Spine> =>
  new Map(
    driver.query(select({
      cols: [
        col('id', 'e'),
        col('eid', 'e'),
        col('num', 'e'),
        col('prefix', 'e'),
        as(grave(col('id', 'e')), 'dead'),
      ],
      ...(eids.length == 1
        ? {
          from: table('entity', 'e'),
          where: eq(col('eid', 'e'), val(eids[0])),
        }
        : {
          from: from(each([...new Set(eids)]), '@eids'),
          joins: [cross(table('entity', 'e', 'sqlite_autoindex_entity_1'))],
          where: eq(col('eid', 'e'), col('value', '@eids')),
        }),
    })).map((r) => [String(r.eid), {
      id: Number(r.id),
      num: r.num == null ? null : Number(r.num),
      prefix: r.prefix == null ? null : String(r.prefix),
      dead: r.dead != null,
    }]),
  )

/** The entities that are tombstoned, of those named. */
export let buried = (driver: Driver, eids: string[]): Set<string> =>
  new Set(
    [...spines(driver, eids)]
      .filter(([, spine]) => spine.dead)
      .map(([eid]) => eid),
  )

// What a mint or a numbering reports: the identity it wrote.
let IDENTITY = [col('eid'), col('num'), col('prefix')]

/**
 * The statement that mints an identity, and returns what it minted. SQLite
 * takes the next number at insert time — inside whatever transaction the
 * statement runs in, so it is exact under a concurrent writer — and RETURNING
 * passes it straight back. `do nothing` on an eid that already has an identity,
 * so minting twice is not an error; RETURNING then emits no row, which is also
 * how the caller knows whether this one was new. A number is opt-IN: left out,
 * the spine is minted with a NULL number, which is what a store whose entities
 * nobody ever types the number of wants. `number = true` gives it a
 * human-readable number.
 *
 * `number` may also be a number, and then it is the one the entity takes: a
 * store seeded from another store's export adopts the numbers that export
 * already carries, because an entity read as `T-37574` somewhere is `T-37574`
 * everywhere. The sequence follows — `entity_number_insert` raises its high
 * water mark — so the next minted number is still past every given one.
 * `prefix` is the letter of the series the number is in, none for a number
 * the store counts without letters.
 */
export let mintSql = (
  eid: string,
  number: boolean | number = false,
  archetype?: number,
  prefix: string | null = null,
): Insert => ({
  t: 'insert',
  into: 'entity',
  cols: ['eid', 'num', 'prefix', ...archetype == null ? [] : ['archetype']],
  rows: [[
    val(eid),
    typeof number == 'number' ? val(number) : number ? next : lit(null),
    number === false || prefix == null ? lit(null) : val(prefix),
    ...archetype == null ? [] : [val(archetype)],
  ]],
  upsert: [{ on: [col('eid')] }],
  returning: IDENTITY,
})

/** The statement that mints identities, from one of @yaks/sql's `parts`:
 * each row an eid, the archetype's integer id it is minted in or null, and
 * the number and prefix it is given or nulls. `next`, each takes a number
 * past the store's one count as the statement found it, in the order the part
 * gives them, in place of its own. It returns what it minted, as
 * {@link mintSql} does, with the id: nothing for an eid that already had
 * one. */
export let mintsSql = (part: string, next = false): Insert => ({
  t: 'insert',
  into: 'entity',
  cols: ['eid', 'num', 'prefix', 'archetype'],
  q: select({
    cols: [
      cell(0),
      next ? op('+', high, op('+', col('key'), lit(1))) : cell(2),
      cell(3),
      cell(1),
    ],
    from: call('json_each', [val(part)]),
    where: and(),
  }),
  upsert: [{ on: [col('eid')] }],
  returning: [...IDENTITY, col('id')],
})

/** The statement that numbers a spine a reference minted, once a bundle of its
 * own arrives: the next number, or the one stated, in the series of `prefix`.
 * It returns what {@link mintSql} does, and nothing where the spine already
 * has a number. */
export let numberSql = (
  eid: string,
  number: true | number,
  prefix: string | null = null,
): Update => ({
  t: 'update',
  table: 'entity',
  set: {
    num: number === true ? next : val(number),
    prefix: prefix == null ? lit(null) : val(prefix),
  },
  where: and(eq(col('eid'), val(eid)), isNull(col('num'))),
  returning: IDENTITY,
})

// The entities holding each of these numbers, any letter, a tombstone
// included: its number is still its address.
let holders = (
  driver: Driver,
  nums: number[],
): Map<number, ({ eid: string } & Pair)[]> =>
  nums.length
    ? Map.groupBy(
      driver.query(select({
        cols: [col('num'), col('prefix'), col('eid')],
        from: table('entity'),
        where: oneOf(col('num'), nums),
      })).map((r) => ({
        eid: String(r.eid),
        num: Number(r.num),
        prefix: r.prefix == null ? null : String(r.prefix),
      })),
      (h) => h.num,
    )
    : new Map()

// An entity's pair set to another, or to none, and the store's memory of its
// spine with it. The counts follow a number set past them
// (`entity_number_update`, `entity_series_update`).
let renumber = (
  driver: Driver,
  eid: string,
  spine: Spine,
  pair: Pair | null,
) => {
  effect(driver, {
    t: 'update',
    table: 'entity',
    set: {
      num: pair == null ? lit(null) : val(pair.num),
      prefix: pair?.prefix == null ? lit(null) : val(pair.prefix),
    },
    where: eq(col('eid'), val(eid)),
  })
  spined(driver).learn(eid, {
    ...spine,
    num: pair?.num ?? null,
    prefix: pair?.prefix ?? null,
  })
}

/** The identity a {@link mintSql} statement reported — the rows it returned —
 * or `undefined` when the eid already had one and nothing was minted. */
export let minted = (rows: Row[]): Entity | undefined =>
  rows[0]
    ? {
      eid: String(rows[0].eid),
      num: rows[0].num == null ? null : Number(rows[0].num),
      ...rows[0].prefix == null ? {} : { prefix: String(rows[0].prefix) },
    }
    : undefined

// Whether this store still counts once for every series: it holds a number
// given before series had letters, or its spine still keeps a number unique
// on its own, as a spine made before series did (`num integer unique`). Until
// its rows are moved and its spine rebuilt, each number given takes the
// store's one count, so it is past every number held, whatever series it is
// in, and no two series give the same one.
let counting = new WeakMap<Driver, boolean>()
let unmoved = (driver: Driver): boolean => {
  let held = counting.get(driver)
  if (held == null) {
    held = sole(driver) || !!driver.query(select({
      cols: [lit(1)],
      from: table('entity'),
      where: and(notNull(col('num')), isNull(col('prefix'))),
      limit: lit(1),
    })).length
    counting.set(driver, held)
  }
  return held
}

// The last number a series gave: this write's, or the store's.
let lastIn = (
  driver: Driver,
  prefix: string,
  given: Map<string, number>,
): number =>
  given.get(prefix) ?? Number(
    driver.query(select({
      cols: [col('high')],
      from: table('entity_series'),
      where: eq(col('prefix'), val(prefix)),
    }))[0]?.high ?? 0,
  )

/**
 * The next number in a series, past the last it gave, stepping over one an
 * entity holds: in the series, or without a letter, which holds its number in
 * every series. `given` keeps what this write has given so far, by letter, so
 * the next asked is past it. Read a window of numbers at a time: a store
 * whose old rows hold most of the low ones steps over them in few reads.
 */
let nextIn = (
  driver: Driver,
  prefix: string,
  given: Map<string, number>,
): number => {
  let n = lastIn(driver, prefix, given)
  for (let width = 64;; n += width) {
    let held = new Set(
      driver.query(select({
        cols: [col('num')],
        from: table('entity'),
        where: and(
          gt(col('num'), val(n)),
          le(col('num'), val(n + width)),
          or(eq(col('prefix'), val(prefix)), isNull(col('prefix'))),
        ),
      })).map((r) => Number(r.num)),
    )
    for (let k = n + 1; k <= n + width; k++) {
      if (!held.has(k)) {
        given.set(prefix, k)
        return k
      }
    }
  }
}

// Whether the entity `e` has no row in `comp` yet.
let lacks = (comp: string): Expr =>
  not(exists(select({
    cols: [lit(1)],
    from: table(comp),
    where: eq(col('entity', comp), col('id', 'e')),
  })))

/**
 * The statement that patches one component onto one entity: insert the sent
 * columns, or update just them on conflict, so an omitted property keeps what
 * it held. A reference property binds its target's eid and resolves to that
 * target's id in the statement. A component whose patch names no stored
 * property is a tag — its row's existence is the whole fact.
 *
 * An INSERT…select is what makes the owner a subquery: no owner row, no
 * inserted row.
 *
 * A tag insert is `or ignore` in both forms: existence is the whole fact it
 * asserts, so a component whose table requires a column the tag cannot supply
 * is a no-op rather than a failed batch. That is what keeps a server-written
 * audit row — one the server writes with its own columns — impossible to create
 * from a client request, without a client being able to fail the batch by
 * naming it.
 */
export let upsertSql = (
  v: Vocab,
  eid: string,
  comp: string,
  patch: Comp,
  absent = false,
  resolve?: Resolve,
): Insert => {
  let cols = Object.keys(patch).filter((c) =>
    v.prop(comp, c)?.computed === false
  )
  let id = resolve?.(eid)
  let source = id ? {} : { from: table('entity', 'e') }
  let where = and(
    ...id ? [] : [eq(col('eid', 'e'), val(eid))],
    ...(absent
      ? [
        id
          ? not(
            exists(
              select({
                cols: [lit(1)],
                from: table(comp),
                where: eq(col('entity', comp), id),
              }),
            ),
          )
          : lacks(comp),
      ]
      : []),
  )
  if (!cols.length) {
    return {
      t: 'insert',
      or: 'ignore',
      into: comp,
      cols: ['entity'],
      q: select({ cols: [id ?? col('id', 'e')], ...source, where }),
    }
  }
  // The value each column takes, as a select item beside the owner id: a
  // reference is another subquery, a scalar is a bound parameter.
  return {
    t: 'insert',
    into: comp,
    cols: ['entity', ...cols.map(field)],
    q: select({
      cols: [
        id ?? col('id', 'e'),
        ...cols.map((c) => slot(v, comp, c, patch[c], resolve)),
      ],
      ...source,
      where,
    }),
    upsert: absent ? undefined : [{
      on: [col('entity')],
      set: Object.fromEntries(
        cols.map((c) => [field(c), col(field(c), 'excluded')]),
      ),
    }],
  }
}

/**
 * The statement that inserts whole rows of one component, from one of
 * @yaks/sql's `parts`: each row its owner's id, then a value per property in
 * `cols`, a reference's already its target's id. A row already there is
 * updated, as {@link upsertSql} does.
 */
export let rowsSql = (
  v: Vocab,
  comp: string,
  cols: string[],
  part: string,
): Insert => ({
  t: 'insert',
  into: comp,
  cols: ['entity', ...cols.map(field)],
  q: select({
    cols: [
      cell(0),
      ...cols.map((c, i) =>
        isJsonb(v, comp, c) ? jsonb(cell(i + 1)) : cell(i + 1)
      ),
    ],
    from: call('json_each', [val(part)]),
    where: and(),
  }),
  upsert: [{
    on: [col('entity')],
    set: Object.fromEntries(
      cols.map((c) => [field(c), col(field(c), 'excluded')]),
    ),
  }],
})

/** The statement that drops one component from one entity — the row goes, the
 * entity stays. */
export let dropSql = (eid: string, comp: string): Delete => ({
  t: 'delete',
  from: comp,
  where: eq(col('entity'), owner(eid)),
})

// The entities one pointer statement names, as one bound list.
let POINTED = 2048

/** The identity metadata write: the pointer and its entity by the integer ids
 * `ids` holds, else by their portable eids. */
export let archetypeSql = (
  b: Bundle,
  ids: ReadonlyMap<string, number> = new Map(),
): Update[] => {
  let { eid, archetype } = b.entity
  if (archetype === undefined) return []
  let id = ids.get(eid), to = ids.get(archetype)
  return [{
    t: 'update',
    table: 'entity',
    set: { archetype: to == null ? owner(archetype) : val(to) },
    where: id == null ? eq(col('eid'), val(eid)) : eq(col('id'), val(id)),
  }]
}

/**
 * The statements that patch one bundle in: a plan per component it names, a drop
 * for each `null` one. Identity is minted separately (see {@link mintSql}),
 * because a batch mints every eid it touches or points at before it writes
 * anything.
 */
export let patchSql = (v: Vocab, b: Bundle): Write[] => [
  ...archetypeSql(b),
  ...comps(b).flatMap(([name, comp]) => {
    let { first, fallback } = patchOne(v, b.entity.eid, name, comp)
    return fallback ? [first, fallback()] : [first]
  }),
]

// One component's plan: a drop, a bare insert, or update then absent insert.
// An interactive driver uses the UPDATE's affected-row count to omit its
// fallback. A batched driver sends both; insert's where is the same no-op.
let patchOne = (
  v: Vocab,
  eid: string,
  name: string,
  comp: Comp | null,
  resolve: Resolve = owner,
): { first: Insert | Update | Delete; fallback?: () => Insert } => {
  if (comp == null) {
    return {
      first: { ...dropSql(eid, name), where: eq(col('entity'), resolve(eid)) },
    }
  }
  // Insert checks NOT NULL before ON CONFLICT. Update existing rows first,
  // then insert only absent ones: partial patches need no invented defaults
  // or read/merge, and the same ordered statements work in a D1 batch.
  let cols = Object.keys(comp).filter((c) =>
    v.prop(name, c)?.computed === false
  )
  let fallback = () =>
    upsertSql(v, eid, name, comp, true, resolve == owner ? undefined : resolve)
  return cols.length
    ? {
      first: {
        t: 'update',
        table: name,
        set: Object.fromEntries(
          cols.map((c) => [field(c), slot(v, name, c, comp[c], resolve)]),
        ),
        where: eq(col('entity'), resolve(eid)),
      },
      fallback,
    }
    : { first: fallback() }
}

/** The statement that clears an entity's tombstone, so the write that follows
 * lands on the identity it kept. */
export let unburySql = (eid: string): Delete => dropSql(eid, TOMBSTONE)

/** Erase empty, unreferenced identity spines, the whole set in three
 * statements whatever its size. The guard runs once per identity, in the
 * write's transaction, including on a deferred adapter: a reference added
 * since its read prevents erasure. The tombstones go first, unguarded, since
 * an identity row is erased only once nothing keys to it; the final NOT NULL
 * assertion then rolls the batch back, tombstones included, when the guard
 * kept an identity, instead of reporting a repair that did not happen. */
export let pruneSql = (
  vocab: Vocab,
  eids: string[],
  held: readonly string[] = tables(vocab),
): Write[] => {
  if (!eids.length) return []
  let listed = array(eids)
  let named = among(col('eid'), listed)
  let holds = (name: string, prop: string): Expr =>
    exists(select({
      cols: [lit(1)],
      from: table(name, '__r'),
      where: eq(col(prop, '__r'), col('id', 'entity')),
    }))
  let stands = new Set(held)
  let empty = and(
    exists(select({
      cols: [lit(1)],
      from: table('archetype', '__shape'),
      where: and(
        eq(col('entity', '__shape'), col('archetype', 'entity')),
        oneOf(fn('json', col('tables', '__shape')), [
          '[]',
          JSON.stringify([TOMBSTONE]),
        ]),
      ),
    })),
    ...vocab.refProps()
      .filter(([c, p]) => stands.has(c) && !vocab.prop(c, p)?.computed)
      .map(([c, p]) => not(holds(c, field(p)))),
    not(holds('entity', 'archetype')),
  )
  return [
    {
      t: 'delete',
      from: TOMBSTONE,
      where: among(
        col('entity'),
        select({ cols: [col('id')], from: table('entity'), where: named }),
      ),
    },
    { t: 'delete', from: 'entity', where: and(named, empty) },
    {
      t: 'insert',
      into: 'entity',
      cols: ['eid'],
      q: select({ cols: [lit(null)], from: table('entity'), where: named }),
    },
  ]
}

/** Run an orphan repair's guarded physical erasure. */
export let prune = (driver: Driver, vocab: Vocab, eids: string[]): void => {
  for (let s of pruneSql(vocab, eids, stood(driver, vocab))) effect(driver, s)
}

/**
 * The statements that remove a set of entities: each component deletion and
 * tombstone insert seeks one owner. An IN subquery lets small-table statistics
 * choose a scan even for a single deletion; equality retains the primary-key
 * plan. Tables arrive in declaration order and are cleared in reverse; an eid
 * no entity uses tombstones nothing. Every statement fits the host bind limit.
 */
export let removeSql = (
  tables: string[],
  entities: Entity[],
  at: string,
): Write[] => {
  if (!entities.length) return []
  return [
    ...tables.toReversed()
      .filter((comp) => comp != 'entity' && comp != TOMBSTONE)
      .flatMap((comp) =>
        entities.map((e): Delete => ({
          t: 'delete',
          from: comp,
          where: eq(col('entity'), owner(e.eid)),
        }))
      ),
    ...entities.map((e) => bury(e.eid, at)),
  ]
}

// The tombstone an entity set's removal ends with.
let bury = (eid: string, at: string): Insert => ({
  t: 'insert',
  or: 'ignore',
  into: 'tombstone',
  cols: ['entity', 'deleted_at'],
  q: select({
    cols: [col('id'), val(at)],
    from: table('entity'),
    where: eq(col('eid'), val(eid)),
  }),
})

/** Every eid these bundles touch or point at, in first-touch order — each
 * bundle's own entity, then the targets of its reference properties. This is
 * the order identity is minted in, so it is the order `num` follows. */
export let touched = (v: Vocab, bundles: Bundle[]): string[] =>
  bundles.flatMap((b) => [
    b.entity.eid,
    ...(b.entity.archetype ? [b.entity.archetype] : []),
    ...comps(b).flatMap(([name, comp]) =>
      Object.entries(comp ?? {})
        .filter(([prop, val]) => val != null && isRef(v, name, prop))
        .map(([, val]) => String(val))
    ),
  ])

/**
 * The classes a unit's births are minted in. An entity is first written in a
 * shape (the tables its first patch gives it) and its unit points it at the
 * class it finished in (@yaks/archetype's flush, after the stamps). Minted in
 * that class from the start, its last pointer restates what its mint said and
 * is not written: pointing an entity rewrites every index of its spine row,
 * since the pointer is a key into the spine's own table. A birth of a shape
 * not seen finishing yet, or one that finishes elsewhere, is pointed as before.
 */
export type Births = {
  /** The archetype's integer id a birth opening holding `tables` is minted
   * in, where one is known. */
  class: (tables: string[]) => number | undefined
  /** `eid` was minted holding `tables`, in the archetype `id` if it says one. */
  born: (eid: string, tables: string[], id?: number) => void
  /** `eid` is pointed at the archetype `id`: whether its mint said so. */
  pointed: (eid: string, id: number) => boolean
  /** Whether `eid`'s mint wrote the pointer of the archetype that names
   * exactly `tables`, so a birth that finished holding them owes none. */
  settled: (eid: string, tables: string[]) => boolean
  /** The archetype `id` names exactly `tables`, which `eid` finished in. */
  finished: (eid: string, tables: string[], id: number) => void
}

/** One unit's {@link Births}, minted in what the connection learned. */
export let births = (driver: Driver): Births => {
  let classes = classed(driver)
  let shape = (tables: string[]) => JSON.stringify([...new Set(tables)].sort())
  let open = new Map<string, { shape: string; id?: number }>()
  return {
    class: (tables) => classes.get(shape(tables)),
    born: (eid, tables, id) => void open.set(eid, { shape: shape(tables), id }),
    pointed: (eid, id) => {
      let birth = open.get(eid)
      if (!birth) return false
      open.delete(eid)
      classes.learn(birth.shape, id)
      return birth.id == id
    },
    // A set's own archetype is kept beside the classes, under the shape no
    // birth opens in.
    settled: (eid, tables) => {
      let id = classes.get(`=${shape(tables)}`)
      if (id == null || open.get(eid)?.id != id) return false
      open.delete(eid)
      return true
    },
    finished: (eid, tables, id) => {
      classes.learn(`=${shape(tables)}`, id)
      let birth = open.get(eid)
      if (!birth) return
      open.delete(eid)
      classes.learn(birth.shape, id)
    },
  }
}

// A patch's whole rows of components its entities did not hold, gathered by
// table and the properties they give, so each table is one statement a part
// (@yaks/sql `parts`) however many entities the patch gives it. Inside a
// transaction every write statement opens a savepoint, copies each page it
// changes into the statement journal, and FTS5 writes what it holds pending as
// a new segment: written a statement per row, a patch paid all three per row.
//
// Each entity's writes land in the order the patch gives them, since a
// trigger may read the entity's other rows (an index over two components, a
// host's own), and no one order of tables fits every entity. So the rows go in
// layers, each writing its tables in the order the patch first gave them
// there: a row joins its entity's last layer where its table comes after the
// entity's last row there, else the layer after. A write that is not gathered
// (`later`) runs at once for an entity with nothing gathered, and otherwise
// after its entity's layer, which the entity's next row then follows; a
// gathered row is told (`done`) once it is written, so what hears rows come
// and go hears each entity's in order too. A row
// whose values JSON would not carry as a bind does (@yaks/sql `jsonable`), or
// whose owner or target has no id here, is not taken and is written alone.
let wholes = (
  driver: Driver,
  vocab: Vocab,
  ids: ReadonlyMap<string, number>,
) => {
  type Group = {
    name: string
    cols: string[]
    rows: Param[][]
    done: (() => void)[]
    at: number
  }
  type Layer = { groups: Map<string, Group>; after: (() => void)[] }
  let layers: Layer[] = []
  // Where each entity's last gathered write is: its layer, and its table's
  // place there, past every table for a write that runs after the layer.
  let last = new Map<string, { layer: number; at: number }>()
  let layer = (i: number) => layers[i] ??= { groups: new Map(), after: [] }
  let flush = () => {
    for (let { groups, after } of layers) {
      for (let { name, cols, rows, done } of groups.values()) {
        for (let part of parts(rows)) {
          write(driver, rowsSql(vocab, name, cols, part))
        }
        for (let then of done) then()
      }
      for (let run of after) run()
    }
    layers = []
    last.clear()
  }
  let later = (eid: string, run: () => void) => {
    let at = last.get(eid)
    if (!at) return run()
    layer(at.layer).after.push(run)
    last.set(eid, { layer: at.layer, at: Infinity })
  }
  let add = (
    eid: string,
    name: string,
    comp: Comp,
    done: () => void,
  ): boolean => {
    let id = ids.get(eid)
    if (id == null) return false
    let cols = Object.keys(comp).filter((c) =>
      vocab.prop(name, c)?.computed === false
    )
    let row: Param[] = [id]
    for (let c of cols) {
      let raw = comp[c]
      let value = raw != null && isRef(vocab, name, c)
        ? ids.get(String(raw))
        : isJsonb(vocab, name, c)
        ? jsonIn(raw)
        : scalar(raw)
      if (value === undefined && raw != null || !jsonable(value)) return false
      row.push(value ?? null)
    }
    let shape = `${name}\0${cols.join('\0')}`
    let was = last.get(eid)
    let i = was?.layer ?? 0
    let { groups } = layer(i)
    let at = groups.get(shape)?.at ?? groups.size
    if (was && at <= was.at) {
      groups = layer(++i).groups
      at = groups.get(shape)?.at ?? groups.size
    }
    let group = groups.get(shape)
    if (!group) {
      groups.set(shape, group = { name, cols, rows: [], done: [], at })
    }
    group.rows.push(row)
    group.done.push(done)
    last.set(eid, { layer: i, at })
    return true
  }
  return { add, later, flush }
}

/**
 * How a store numbers its entities: not at all, with one count for every
 * entity and no letters (`true`), or by series, given which letter each
 * component numbers with ({@link Series}, @yaks/graph). By series, an entity
 * is numbered on the write that first gives it a component in the table, in
 * the series `seriesOf` picks, and its letter never changes afterwards.
 */
export type Numbering = boolean | Series

// The number an entity is minted with: none, the store's next count, or its
// own, with the letter of its series.
type Take = false | { num: 'next' | number; prefix: string | null }

/**
 * Patch a batch of bundles in, in order, and return the spines this patch
 * minted or numbered — each with the `num` and `prefix` it was given, as the
 * statement itself reported it. A bundle for a tombstoned entity is skipped:
 * bringing one back is `revive`'s, which @yaks/graph asks for first.
 *
 * An eid a reference only names still gets a spine, because a reference column
 * holds its target's id, but that spine takes no number: it is a pointer to
 * nothing, which a yaks app pointing into another app's store makes on
 * purpose, and @yaks/graph brings no entity into being for it. It is numbered
 * when a bundle of its own arrives, in this batch or a later one.
 *
 * Numbered by series, a number is the one after the last its series gave
 * (`entity_series`), stepping over one an entity holds. A store still holding
 * numbers given before series had letters gives each the store's one count,
 * so it is past all of them, with its letter.
 *
 * `moved` hears each component row this patch brought or took away, as the
 * table and whether the entity holds one now: what may have moved its
 * archetype (./archetype.ts `ledger`). A value-only patch says nothing.
 *
 * `had` is what memory says an entity held before this patch: a component
 * it does not hold is written in one statement, as a new entity's are.
 *
 * An entity minted here takes its pointer in its mint where one is known: the
 * one its own bundle names, or the class `born` says its shape finishes in
 * ({@link Births}). A pointer its mint already wrote is not written again.
 *
 * `unsettled` says what an entity this transaction wrote holds, where the
 * patch reads one (./read.ts `Unsettled`).
 */
export let patch = (
  driver: Driver,
  vocab: Vocab,
  bundles: Bundle[],
  number: Numbering = false,
  moved?: Moved,
  had?: Known,
  born?: Births,
  unsettled?: Unsettled,
): Entity[] => {
  // A computed component's rows are another package's (@yaks/sql `Backing`):
  // there is no table here to write one to.
  for (let b of bundles) {
    for (let [name] of comps(b)) {
      if (vocab.comp(name)?.computed) {
        throw new Refused(`${name} is computed: it is read, never written`)
      }
    }
  }
  let from = revision(driver, 'descriptors')
  let known = spines(driver, [...new Set(touched(vocab, bundles))])
  let alive = bundles.filter((b) => !known.get(b.entity.eid)?.dead)
  let ids = new Map([...known].map(([eid, row]) => [eid, row.id]))
  let resolve: Resolve = (eid) => ids.has(eid) ? val(ids.get(eid)!) : owner(eid)
  let pairOf = (eid: string): Pair | null | undefined => {
    let k = known.get(eid)
    return !k ? undefined : k.num == null ? null : {
      num: k.num,
      prefix: k.prefix ?? null,
    }
  }

  // What each bundle states its entity's pair to be: one to take, or `null`
  // for none, born or not, checked against the pairs every other entity
  // holds, a tombstone's included (@yaks/graph `renumbering`), whatever its
  // letter on a spine that keeps a number unique on its own (`sole`). A
  // vocabulary that declares no number (@yaks/id) reads none back, and a
  // stated one says nothing to it.
  let stated = new Map<string, Pair | null>()
  for (let b of vocab.prop('entity', 'num') ? alive : []) {
    let pair = stating(b.entity, pairOf(b.entity.eid))
    if (pair !== undefined) stated.set(b.entity.eid, pair)
  }
  let lone = stated.size > 0 && sole(driver)
  let renumbered = stated.size
    ? renumbering(
      stated,
      pairOf,
      holders(driver, [...stated.values()].flatMap((p) => p ? [p.num] : [])),
      lone,
    )
    : new Map<string, Pair | null>()
  // An entity stated to hold none lets go of its pair, as does one whose
  // pair another entity of the batch takes, before any is given, so that one
  // is free for it. Every other entity moves in its one update: a number
  // taking its letter (yak/store/number-letter/1) writes its row and indexes
  // once, not twice.
  let meets = meeting(lone)
  let taking = new Map<number, [string, Pair][]>()
  for (let [eid, pair] of renumbered) {
    if (pair) taking.set(pair.num, [...taking.get(pair.num) ?? [], [eid, pair]])
  }
  let moving = [...renumbered.keys()].filter((eid) => {
    let held = known.get(eid)
    if (held?.num == null) return false
    if (renumbered.get(eid) == null) return true
    let was = { num: held.num, prefix: held.prefix ?? null }
    return (taking.get(was.num) ?? []).some(([other, pair]) =>
      other != eid && meets(pair, was)
    )
  })
  for (let eid of moving) renumber(driver, eid, known.get(eid)!, null)
  // The eids a bundle of their own arrives for: one giving a component, or
  // one stating the number.
  let own = new Set([
    ...alive.filter((b) => comps(b).some(([, c]) => c != null))
      .map((b) => b.entity.eid),
    ...stated.keys(),
  ])

  // What the live bundles give each entity, and the pointer they name for
  // it: what a mint is told it opens holding, and the class it may take.
  let opening = new Map<string, string[]>()
  let named = new Map<string, string>()
  for (let b of alive) {
    let eid = b.entity.eid
    let held = opening.get(eid) ?? []
    opening.set(eid, held)
    for (let [name, comp] of comps(b)) if (comp != null) held.push(name)
    if (b.entity.archetype) named.set(eid, b.entity.archetype)
  }
  // The number an entity takes: the pair its bundle states; else none where
  // the store numbers nothing; else the store's one count, with no letter
  // where it numbers without them, and in the series its components pick
  // where it numbers by series. `held` is what it holds besides this batch.
  let series = typeof number == 'object' ? seriesOf(vocab, number) : undefined
  let counted = series ? unmoved(driver) : true
  let given = new Map<string, number>()
  let take = (eid: string, held: string[] = []): Take => {
    let pair = stated.get(eid)
    if (pair?.prefix) {
      let last = lastIn(driver, pair.prefix, given)
      given.set(pair.prefix, Math.max(last, pair.num))
    }
    if (stated.has(eid)) return pair ?? false
    if (!number) return false
    let prefix = series?.([...held, ...opening.get(eid) ?? []])
    if (series && !prefix) return false
    return counted
      ? { num: 'next', prefix: prefix ?? null }
      : { num: nextIn(driver, prefix!, given), prefix: prefix! }
  }
  // The pointer each mint wrote, so the bundle naming it writes it once.
  let pointers = new Map<string, number>()
  let made: Entity[] = []
  let seen = new Set(known.keys())
  // A mint the store learns of: its id, and the class it opened in.
  let took = (row: Row, tables: string[], pointer?: number) => {
    let id = Number(row.id)
    ids.set(String(row.eid), id)
    spined(driver).learn(String(row.eid), {
      id,
      num: row.num == null ? null : Number(row.num),
      prefix: row.prefix == null ? null : String(row.prefix),
      dead: false,
    })
    if (pointer != null) pointers.set(String(row.eid), pointer)
    born?.born(String(row.eid), tables, pointer)
    made.push(minted([row])!)
  }
  // The eids minted wait to be minted together, a statement a part
  // ({@link mintsSql}), while each takes the store's next count or each
  // takes its own. One that changes which sends those before it first, so
  // ids and numbers follow the batch's order.
  type Waiting = { tables: string[]; pointer?: number; take: Take }
  let waiting = new Map<string, Waiting>()
  let counting = false
  let mint = () => {
    let rows = new Map<string, Row>()
    let list = [...waiting].map(([eid, w]) => [
      eid,
      w.pointer ?? null,
      w.take && w.take.num != 'next' ? w.take.num : null,
      w.take ? w.take.prefix : null,
    ])
    for (let part of parts(list)) {
      for (let r of driver.query(mintsSql(part, counting))) {
        rows.set(String(r.eid), r)
      }
    }
    for (let [eid, { tables, pointer }] of waiting) {
      let row = rows.get(eid)
      if (row) took(row, tables, pointer)
    }
    waiting.clear()
  }
  // Mint a spine for every eid the live bundles touch or point at, so a
  // reference can name a target created in the same batch, in any order. An
  // eid the store already knows is skipped here and would be a no-op anyway.
  for (let eid of touched(vocab, alive)) {
    if (seen.has(eid)) continue
    seen.add(eid)
    let tables = opening.get(eid) ?? []
    let to = named.get(eid)
    if (to != null && waiting.has(to)) mint()
    let pointer = to == null
      ? born?.class(tables)
      : to == eid
      ? undefined
      : ids.get(to)
    let t = own.has(eid) ? take(eid) : false
    let next = !!t && t.num == 'next'
    if (next != counting) mint()
    counting = next
    waiting.set(eid, { tables, pointer, take: t })
  }
  mint()
  // A spine an earlier reference minted, or an entity numbered nothing so
  // far, is numbered now if its own bundle gives what numbers it: by one
  // count, only a spine that carries nothing, since an unnumbered entity
  // that carries something was left so on purpose; by series, the first
  // component in its series.
  let lettered = typeof number == 'object' ? Object.keys(number) : []
  let pointed = [...own].filter((eid) => {
    let k = known.get(eid)
    return k && !k.dead && k.num == null && !stated.has(eid) && !!number &&
      (!series || (opening.get(eid) ?? []).some((c) => lettered.includes(c)))
  })
  if (pointed.length) {
    for (let b of get(driver, vocab, pointed, {}, undefined, unsettled)) {
      let held = comps(b).map(([name]) => name)
      if (!series && held.length) continue
      let t = take(b.entity.eid, held)
      if (!t) continue
      let e = minted(driver.query(
        numberSql(b.entity.eid, t.num == 'next' ? true : t.num, t.prefix),
      ))
      if (e) made.push(e)
    }
  }
  // Every entity the store held before the batch takes the pair stated for
  // it; one born here took it as it was minted.
  for (let [eid, pair] of renumbered) {
    let k = known.get(eid)
    if (k && pair != null) renumber(driver, eid, k, pair)
  }

  // The physical table is the last word on required columns: an older store
  // can still hold a stricter table while its vocabulary is being fitted.
  // A patch supplying every required value can use one INSERT…ON CONFLICT;
  // a partial one must UPDATE first, since SQLite checks NOT NULL before the
  // conflict handler can preserve the row's omitted values.
  let full = (name: string, comp: Comp): boolean => {
    let cols = Object.keys(comp).filter((c) =>
      vocab.prop(name, c)?.computed === false
    )
    return cols.length > 0 &&
      required(driver, name).every((prop) => comp[prop] != null)
  }
  // A spine minted here holds no row yet, nor does a component memory knows
  // an entity lacks, so a whole one is one INSERT…ON CONFLICT and certainly a
  // row that came. Anywhere else a write's own count says whether a row came
  // or went: the UPDATE hit, or the absent INSERT or the drop did something.
  let fresh = new Set(made.map((e) => e.eid))
  let lacks = (eid: string, name: string) =>
    fresh.has(eid) || had?.(eid, name) === null
  // What a patch gives a row memory knows, less what the row holds already:
  // writing a value again rewrites its row and every index over it. Memory
  // speaks of the row as this patch found it, so a row an earlier bundle of
  // the patch wrote is written as given.
  let wrote = new Set<string>()
  let news = (eid: string, name: string, comp: Comp): Comp => {
    let held = had?.(eid, name)
    if (!held || wrote.has(`${eid}\0${name}`)) return comp
    return Object.fromEntries(
      Object.entries(comp).filter(([prop, value]) =>
        !(prop in held) || !same(held[prop], value)
      ),
    )
  }
  let whole = wholes(driver, vocab, ids)
  for (let b of alive) {
    let eid = b.entity.eid
    for (let [name, given] of comps(b)) {
      let comp = given && news(eid, name, given)
      wrote.add(`${eid}\0${name}`)
      if (given != null && lacks(eid, name) && full(name, given)) {
        let came = () => moved?.(eid, name, true)
        if (!whole.add(eid, name, given, came)) {
          whole.later(eid, () => {
            write(driver, upsertSql(vocab, eid, name, given, false, resolve))
            came()
          })
        }
        continue
      }
      if (comp && Object.keys(given!).length && !Object.keys(comp).length) {
        continue
      }
      whole.later(eid, () => {
        let { first, fallback } = patchOne(vocab, eid, name, comp, resolve)
        let changes = ran(driver, first)
        // A write's own result avoids the absent INSERT when UPDATE hit. D1
        // still sends the complete plan atomically via patchSql; no read/merge.
        if (fallback && !changes) changes = ran(driver, fallback())
        else if (fallback) return
        if (changes) moved?.(eid, name, comp != null)
      })
    }
  }
  whole.flush()

  // Metadata can classify a tombstone too; on its own it brings nothing back.
  // A pointer this entity's mint already wrote is not written again. The
  // entities pointed at one archetype both go by their integer ids are pointed
  // in one statement a part: a batch of births in a class the unit has not
  // seen finish, or of deaths, points hundreds of entities at one.
  let pointing = new Map<number, number[]>()
  for (let b of bundles) {
    let { eid, archetype } = b.entity
    let to = archetype == null ? undefined : ids.get(archetype)
    let said = to != null && born?.pointed(eid, to)
    if (to != null && (said || pointers.get(eid) == to)) continue
    let id = ids.get(eid)
    if (to == null || id == null) {
      for (let s of archetypeSql(b, ids)) effect(driver, s)
      continue
    }
    let group = pointing.get(to)
    if (!group) pointing.set(to, group = [])
    group.push(id)
  }
  for (let [to, owners] of pointing) {
    for (let i = 0; i < owners.length; i += POINTED) {
      effect(driver, {
        t: 'update',
        table: 'entity',
        set: { archetype: val(to) },
        where: oneOf(col('id'), owners.slice(i, i + POINTED)),
      })
    }
  }
  // The descriptors written here are all that moved one, unless one went.
  let defined = alive.filter((b) => b.archetype !== undefined)
  if (
    defined.length && defined.every((b) => b.archetype && ids.has(b.entity.eid))
  ) {
    described(
      driver,
      from,
      defined.map((b) => ({
        id: ids.get(b.entity.eid)!,
        eid: b.entity.eid,
        tables: String((b.archetype as Comp).tables),
      })),
    )
  }
  return made
}

// How many rows a write changed: the driver's own count where it keeps one,
// else the rows the statement returns. On a store with history a write runs
// between the statements that keep its versions (./history.ts), those after it
// made from the owners of the rows it returns, and the count is its own.
let ran = (driver: Driver, w: Insert | Update | Delete): number => {
  let { before, write: one, after } = kept(driver, w)
  for (let s of before) effect(driver, s)
  if (after) return owned(driver, one, after)
  return driver.run?.(one) ??
    driver.query({ ...one, returning: [col('entity')] }).length
}

// A write whose count nobody reads, kept the same way.
let write = (driver: Driver, w: Write): void => {
  if (w.t == 'select') return void effect(driver, w)
  let { before, write: one, after } = kept(driver, w)
  for (let s of before) effect(driver, s)
  if (after) owned(driver, one, after)
  else effect(driver, one)
}

// A write whose versions follow the rows it wrote: run returning their
// owners, then what those owners need. Answers how many it wrote.
let owned = (
  driver: Driver,
  one: Insert | Update | Delete,
  after: (owners: number[]) => Write[],
): number => {
  let rows = driver.query({ ...one, returning: [col('entity')] })
  for (let s of after(rows.map((r) => Number(r.entity)))) effect(driver, s)
  return rows.length
}

/** What memory says an entity holds of a component, read or written before:
 * its row, with the values memory can vouch for as a read returns them,
 * `null` for none, and `undefined` where memory does not know (./memo.ts). */
export type Known = (eid: string, name: string) => Comp | null | undefined

// Whether a value a patch gives is the one a row holds, as a read returns it.
let same = (held: unknown, given: unknown): boolean =>
  held === given ||
  (typeof held == 'object' && typeof given == 'object' && held != null &&
    given != null && JSON.stringify(held) == JSON.stringify(given))

/** What hears a component row come (`held`) or go, entity by entity. */
export type Moved = (eid: string, table: string, held: boolean) => void

/** Bring these tombstoned entities back: each tombstone row goes, and the
 * identity keeps its eid, number and integer id. No component returns; the
 * patch after it gives them. An eid with no tombstone is left alone; `moved`
 * hears each tombstone that went, as {@link patch} tells its rows. */
export let revive = (driver: Driver, eids: string[], moved?: Moved): void => {
  for (let eid of eids) {
    if (ran(driver, unburySql(eid))) moved?.(eid, TOMBSTONE, false)
  }
}

/**
 * Remove these entities: every component row they have goes, and their identity
 * is tombstoned, keeping its eid and number. Exactly the entities named —
 * @yaks/graph decided which they are. `held` is the tables they hold rows in,
 * where the caller knows (a store that keeps archetypes reads them off the
 * entities' pointers, ./archetype.ts `heldBy`); left out, it reads their
 * pointers itself. An unclassified entity is a failure, never every table.
 */
export let remove = (
  driver: Driver,
  _vocab: Vocab,
  entities: Entity[],
  held: string[] = heldBy(driver, entities.map((e) => e.eid)),
  at: string = new Date().toISOString(),
): void => {
  for (let s of removeSql(held, entities, at)) write(driver, s)
}
