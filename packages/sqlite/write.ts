// Writes: bundles patched into the store, and entities removed from it. This
// is the PATCH half of the adapter — the mirror image of the reads in
// ./read.ts — and it honors the rules a graph patch honors everywhere:
//
//   omitted properties are untouched    a patch names only what changes
//   a property set to null is cleared   null is a value, not an absence
//   a component set to null is dropped  the row goes, the entity stays
//   a tombstoned entity takes no patch  deletion is final; ids never recycle
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

import type { Vocab } from '@yaks/vocab'
import type { Bundle, Comp, Entity } from '@yaks/graph'
import { comps } from '@yaks/graph'
import {
  among,
  and,
  as,
  col,
  type Delete,
  type Driver,
  each,
  effect,
  eq,
  exists,
  type Expr,
  type Insert,
  isNull,
  join,
  left,
  lit,
  not,
  notNull,
  op,
  type Param,
  type Row,
  select,
  type Stmt,
  sub,
  table,
  type Update,
  val,
  type Write,
} from '@yaks/sql'
import { componentTables } from './physical.ts'
import { isJsonb, jsonb, jsonIn } from './jsonb.ts'
import { keyed } from './keyed.ts'

// The owner's integer id, as a subquery. Every write keys to it, so an entity
// minted earlier in the same unit of work resolves without a second question.
let owner = (eid: string): Expr =>
  sub(select({
    cols: [col('id')],
    from: table('entity'),
    where: eq(col('eid'), val(eid)),
  }))

// The next number, past the sequence's high-water mark.
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
let slot = (v: Vocab, comp: string, prop: string, raw: unknown): Expr =>
  raw != null && isRef(v, comp, prop)
    ? owner(String(raw))
    : isJsonb(v, comp, prop)
    ? jsonb(val(jsonIn(raw)))
    : val(scalar(raw))

/** What the store already knows about an eid: its number, and whether that
 * identity is tombstoned. An eid with no entry has no entity yet. */
export type Spine = { num: number | null; dead: boolean }

/** What the store knows about these eids — one statement and one bound
 * parameter, whatever the batch's size (a Durable Object binds at most 100).
 * An eid absent from the map has no entity; one present with `dead` is
 * tombstoned, and a deleted identity is still an identity: it resolves by eid
 * forever, it just takes no more writes. */
export let spines = (
  driver: Driver,
  eids: string[],
): Map<string, Spine> => {
  if (!eids.length) return new Map()
  return new Map(
    driver.query(select({
      cols: [col('eid', 'e'), col('num', 'e'), as(col('entity', 't'), 'dead')],
      from: table('entity', 'e'),
      joins: [
        left(table('tombstone', 't'), eq(col('entity', 't'), col('id', 'e'))),
      ],
      where: among(col('eid', 'e'), each(eids)),
    })).map((r) => [String(r.eid), {
      num: r.num == null ? null : Number(r.num),
      dead: r.dead != null,
    }]),
  )
}

/** The entities that are tombstoned, of those named. */
export let buried = (driver: Driver, eids: string[]): Set<string> =>
  new Set(
    [...spines(driver, eids)]
      .filter(([, spine]) => spine.dead)
      .map(([eid]) => eid),
  )

// What a mint or a numbering reports: the identity it wrote.
let IDENTITY = [col('eid'), col('num')]

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
 */
export let mintSql = (
  eid: string,
  number: boolean | number = false,
): Insert => ({
  t: 'insert',
  into: 'entity',
  cols: ['eid', 'num'],
  rows: [[
    val(eid),
    typeof number == 'number' ? val(number) : number ? next : lit(null),
  ]],
  upsert: [{ on: [col('eid')] }],
  returning: IDENTITY,
})

/** The statement that numbers a spine a reference minted, once a bundle of its
 * own arrives: the next number, or the one stated. It returns what
 * {@link mintSql} does, and nothing where the spine already has a number. */
export let numberSql = (eid: string, number: true | number): Update => ({
  t: 'update',
  table: 'entity',
  set: { num: number === true ? next : val(number) },
  where: and(eq(col('eid'), val(eid)), isNull(col('num'))),
  returning: IDENTITY,
})

/** The identity a {@link mintSql} statement reported — the rows it returned —
 * or `undefined` when the eid already had one and nothing was minted. */
export let minted = (rows: Row[]): Entity | undefined =>
  rows[0]
    ? {
      eid: String(rows[0].eid),
      num: rows[0].num == null ? null : Number(rows[0].num),
    }
    : undefined

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
): Insert => {
  let cols = Object.keys(patch).filter((c) =>
    v.prop(comp, c)?.computed === false
  )
  let where = and(
    eq(col('eid', 'e'), val(eid)),
    ...(absent ? [lacks(comp)] : []),
  )
  if (!cols.length) {
    return {
      t: 'insert',
      or: 'ignore',
      into: comp,
      cols: ['entity'],
      q: select({ cols: [col('id', 'e')], from: table('entity', 'e'), where }),
    }
  }
  // The value each column takes, as a select item beside the owner id: a
  // reference is another subquery, a scalar is a bound parameter.
  return {
    t: 'insert',
    into: comp,
    cols: ['entity', ...cols],
    q: select({
      cols: [col('id', 'e'), ...cols.map((c) => slot(v, comp, c, patch[c]))],
      from: table('entity', 'e'),
      where,
    }),
    upsert: absent ? undefined : [{
      on: [col('entity')],
      set: Object.fromEntries(cols.map((c) => [c, col(c, 'excluded')])),
    }],
  }
}

/** The statement that drops one component from one entity — the row goes, the
 * entity stays. */
export let dropSql = (eid: string, comp: string): Delete => ({
  t: 'delete',
  from: comp,
  where: eq(col('entity'), owner(eid)),
})

/** The identity metadata write, using the portable eid as an integer lookup. */
export let archetypeSql = (b: Bundle): Update[] =>
  b.entity.archetype === undefined ? [] : [{
    t: 'update',
    table: 'entity',
    set: { archetype: owner(b.entity.archetype) },
    where: eq(col('eid'), val(b.entity.eid)),
  }]

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
): { first: Insert | Update | Delete; fallback?: () => Insert } => {
  if (comp == null) return { first: dropSql(eid, name) }
  // Insert checks NOT NULL before ON CONFLICT. Update existing rows first,
  // then insert only absent ones: partial patches need no invented defaults
  // or read/merge, and the same ordered statements work in a D1 batch.
  let cols = Object.keys(comp).filter((c) =>
    v.prop(name, c)?.computed === false
  )
  let fallback = () => upsertSql(v, eid, name, comp, true)
  return cols.length
    ? {
      first: {
        t: 'update',
        table: name,
        set: Object.fromEntries(
          cols.map((c) => [c, slot(v, name, c, comp[c])]),
        ),
        where: eq(col('entity'), owner(eid)),
      },
      fallback,
    }
    : { first: fallback() }
}

/**
 * The statements that remove one entity: every component row it has, then the
 * tombstone that keeps its id from ever being reused. Components go in reverse
 * declaration order, so a dependent is gone before what it references and no
 * foreign key blocks the delete. The tombstone is an INSERT…select, so an eid
 * no entity uses tombstones nothing.
 */
export let removeSql = (v: Vocab, entity: Entity, at: string): Write[] => [
  ...[...v.all].reverse()
    .filter((comp) => comp != 'entity')
    .map((comp) => dropSql(entity.eid, comp)),
  bury(entity.eid, at),
]

// The tombstone an entity's removal ends with.
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

// Whether an entity already wears a component, asked of its row.
let wears = (driver: Driver, comp: string, eid: string): boolean =>
  driver.query(select({
    cols: [lit(1)],
    from: table(comp, 'c'),
    joins: [join(table('entity', 'e'), eq(col('id', 'e'), col('entity', 'c')))],
    where: eq(col('eid', 'e'), val(eid)),
  })).length > 0

/**
 * Patch a batch of bundles in, in order, and return the spines this patch
 * minted or numbered — each with the `num` it was given, as the statement
 * itself reported it. A bundle for a tombstoned entity is skipped: death is
 * final.
 *
 * An eid a reference only names still gets a spine, because a reference column
 * holds its target's id, but that spine takes no number: it is a pointer to
 * nothing, which a yaks app pointing into another app's store makes on
 * purpose, and @yaks/graph brings no entity into being for it. It is numbered
 * when a bundle of its own arrives, in this batch or a later one.
 */
export let patch = (
  driver: Driver,
  vocab: Vocab,
  bundles: Bundle[],
  number: boolean | { except: readonly string[] } = false,
  adopt = false,
): Entity[] => {
  let known = spines(driver, [...new Set(touched(vocab, bundles))])
  let alive = bundles.filter((b) => !known.get(b.entity.eid)?.dead)

  // Mint a spine for every eid the live bundles touch or point at, so a
  // reference can name a target created in the same batch, in any order. An
  // eid the store already knows is skipped here and would be a no-op anyway.
  // Classification sees the whole admitted batch, including targets referenced
  // before their own bundle. Entities that already carry an excluded component
  // remain unnumbered.
  let excluded = new Set<string>()
  if (typeof number == 'object') {
    // A component no plugin here declares is worn by nothing: a config names
    // its exceptions once, for every graph it opens.
    for (let name of number.except.filter((n) => vocab.comp(n))) {
      for (let b of alive) {
        if (!known.has(b.entity.eid)) continue
        if (wears(driver, name, b.entity.eid)) excluded.add(b.entity.eid)
      }
      for (let b of alive) if (b[name] != null) excluded.add(b.entity.eid)
    }
    for (let eid of excluded) {
      if (!known.has(eid)) continue
      driver.query({
        t: 'update',
        table: 'entity',
        set: { num: lit(null) },
        where: and(eq(col('eid'), val(eid)), notNull(col('num'))),
      })
    }
  }
  // What each bundle states its entity's number to be, where the store is
  // adopting rather than minting: a number to take, or `null` for none. Only a
  // birth honours it — a number in use is not something a later batch may
  // reassign.
  let stated = new Map<string, number | null>()
  if (adopt) {
    for (let b of alive) {
      if (b.entity.num !== undefined) stated.set(b.entity.eid, b.entity.num)
    }
  }
  // The number an entity is born with: none where the store numbers nothing or
  // the entity wears an excepted component, the stated one where the store is
  // adopting, else the next.
  let take = (eid: string): boolean | number =>
    number === false || excluded.has(eid)
      ? false
      : !stated.has(eid)
      ? true
      : stated.get(eid) ?? false
  // The eids a bundle of their own arrives for: one giving a component, or,
  // where the store is adopting, one stating the number.
  let own = new Set([
    ...alive.filter((b) => comps(b).some(([, c]) => c != null))
      .map((b) => b.entity.eid),
    ...stated.keys(),
  ])
  let born: Entity[] = []
  let seen = new Set(known.keys())
  for (let eid of touched(vocab, alive)) {
    if (seen.has(eid)) continue
    seen.add(eid)
    let e = minted(driver.query(mintSql(eid, own.has(eid) && take(eid))))
    if (e) born.push(e)
  }
  // A spine an earlier reference minted is numbered now, if it still carries
  // nothing: an unnumbered entity that carries something was left unnumbered
  // on purpose, and keeps it that way.
  let pointed = [...own].filter((eid) => {
    let k = known.get(eid)
    return k && !k.dead && k.num == null && take(eid) !== false
  })
  if (pointed.length) {
    for (let b of keyed(driver, vocab, {})(pointed)) {
      let n = take(b.entity.eid)
      if (n === false || comps(b).length) continue
      let e = minted(driver.query(numberSql(b.entity.eid, n)))
      if (e) born.push(e)
    }
  }

  for (let b of alive) {
    for (let [name, comp] of comps(b)) {
      let { first, fallback } = patchOne(vocab, b.entity.eid, name, comp)
      let changes = driver.run?.(first)
      if (changes === undefined) {
        changes = driver.query(
          fallback ? { ...first, returning: [col('entity')] } : first,
        ).length
      }
      // A write's own result avoids the absent INSERT when UPDATE hit. D1
      // still sends the complete plan atomically via patchSql; no read/merge.
      if (fallback && !changes) effect(driver, fallback())
    }
  }

  // Metadata can classify a tombstone too; it does not resurrect components.
  for (let b of bundles) for (let s of archetypeSql(b)) effect(driver, s)
  return born
}

/**
 * Remove these entities: every component row they have goes, and their identity
 * is tombstoned so the id can never be reused. Exactly the entities named —
 * @yaks/graph decided which they are.
 */
export let remove = (
  driver: Driver,
  vocab: Vocab,
  entities: Entity[],
): void => {
  let now = new Date().toISOString()
  // With table-based identities enabled, deletion must honor that same
  // physical set even when this writer has a narrower vocabulary.
  let physical = vocab.comp('archetype') ? componentTables(driver) : undefined
  for (let e of entities) {
    let statements: Stmt[] = physical
      ? [
        ...physical.filter((n) => n != 'tombstone').map((n) =>
          dropSql(e.eid, n)
        ),
        bury(e.eid, now),
      ]
      : removeSql(vocab, e, now)
    for (let s of statements) effect(driver, s)
  }
}
