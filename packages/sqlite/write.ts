// Writes: bundles patched into the store, and entities removed from it. This
// is the PATCH half of the adapter — the mirror image of the reads in
// ./read.ts — and it honors the rules a graph patch honors everywhere:
//
//   omitted properties are untouched    a patch names only what changes
//   a property set to null is cleared   null is a value, not an absence
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
import { comps, Refused, TOMBSTONE } from '@yaks/graph'
import {
  among,
  and,
  as,
  col,
  type Delete,
  type Driver,
  effect,
  eq,
  exists,
  type Expr,
  type Insert,
  isNull,
  left,
  lit,
  not,
  notNull,
  oneOf,
  op,
  or,
  type Param,
  type Row,
  select,
  sub,
  table,
  type Update,
  val,
  type Write,
} from '@yaks/sql'
import { tables } from './ddl.ts'
import { required } from './physical.ts'
import { spined } from './memo.ts'
import { isJsonb, jsonb, jsonIn } from './jsonb.ts'
import { described, get } from './read.ts'

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

/** What the store already knows about an eid: its number, and whether that
 * identity is tombstoned. An eid with no entry has no entity yet. */
export type Spine = { id: number; num: number | null; dead: boolean }

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
        as(col('entity', 't'), 'dead'),
      ],
      from: table('entity', 'e'),
      joins: [
        left(table('tombstone', 't'), eq(col('entity', 't'), col('id', 'e'))),
      ],
      where: oneOf(col('eid', 'e'), eids),
    })).map((r) => [String(r.eid), {
      id: Number(r.id),
      num: r.num == null ? null : Number(r.num),
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

/** The statement that drops one component from one entity — the row goes, the
 * entity stays. */
export let dropSql = (eid: string, comp: string): Delete => ({
  t: 'delete',
  from: comp,
  where: eq(col('entity'), owner(eid)),
})

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

/**
 * The statements that remove a set of entities: one delete per component
 * table, then one tombstone insert for the set. A list of any length rides as
 * one JSON parameter, so a wide vocabulary and a large batch do not multiply
 * storage operations by one another. Tables arrive in declaration order and
 * are cleared in reverse; an eid no entity uses tombstones nothing.
 */
export let removeSql = (
  tables: string[],
  entities: Entity[],
  at: string,
): Write[] => {
  if (!entities.length) return []
  let ids = select({
    cols: [col('id')],
    from: table('entity'),
    where: oneOf(col('eid'), entities.map((e) => e.eid)),
  })
  return [
    ...tables.toReversed()
      .filter((comp) => comp != 'entity' && comp != TOMBSTONE)
      .map((comp): Delete => ({
        t: 'delete',
        from: comp,
        where: among(col('entity'), ids),
      })),
    bury(ids, at),
  ]
}

// The tombstone an entity set's removal ends with.
let bury = (ids: ReturnType<typeof select>, at: string): Insert => ({
  t: 'insert',
  or: 'ignore',
  into: 'tombstone',
  cols: ['entity', 'deleted_at'],
  q: select({
    cols: [col('id'), val(at)],
    from: table('entity'),
    where: among(col('id'), ids),
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

// Which entities wear any of these components. One statement answers the
// whole batch, with indexed presence probes and one bound eid list.
let wears = (driver: Driver, tables: string[], eids: string[]): Set<string> => {
  if (!tables.length || !eids.length) return new Set()
  return new Set(
    driver.query(select({
      cols: [col('eid', 'e')],
      from: table('entity', 'e'),
      where: and(
        oneOf(col('eid', 'e'), eids),
        or(...tables.map((comp) =>
          exists(select({
            cols: [lit(1)],
            from: table(comp, 'c'),
            where: eq(col('entity', 'c'), col('id', 'e')),
          }))
        )),
      ),
    })).map((r) => String(r.eid)),
  )
}

/**
 * Patch a batch of bundles in, in order, and return the spines this patch
 * minted or numbered — each with the `num` it was given, as the statement
 * itself reported it. A bundle for a tombstoned entity is skipped: bringing
 * one back is `revive`'s, which @yaks/graph asks for first.
 *
 * An eid a reference only names still gets a spine, because a reference column
 * holds its target's id, but that spine takes no number: it is a pointer to
 * nothing, which a yaks app pointing into another app's store makes on
 * purpose, and @yaks/graph brings no entity into being for it. It is numbered
 * when a bundle of its own arrives, in this batch or a later one.
 *
 * `moved` hears each component row this patch brought or took away, as the
 * table and whether the entity holds one now: what may have moved its
 * archetype (./archetype.ts `ledger`). A value-only patch says nothing.
 *
 * `had` is what memory says an entity held before this patch: a component
 * it does not hold is written in one statement, as a new entity's are.
 */
export let patch = (
  driver: Driver,
  vocab: Vocab,
  bundles: Bundle[],
  number: boolean | { except: readonly string[] } = false,
  adopt = false,
  moved?: Moved,
  had?: Known,
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
  // The eids a bundle of their own arrives for: one giving a component, or,
  // where the store is adopting, one stating the number.
  let own = new Set([
    ...alive.filter((b) => comps(b).some(([, c]) => c != null))
      .map((b) => b.entity.eid),
    ...stated.keys(),
  ])

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
    let tables = [...new Set(number.except.filter((n) => vocab.comp(n)))]
    for (let name of tables) {
      for (let b of alive) if (b[name] != null) excluded.add(b.entity.eid)
    }
    // What a known entity already wears is asked only where it decides
    // something: a number it has to lose, or one a bundle of its own would
    // give it.
    let asked = [...new Set(alive.map((b) => b.entity.eid))].filter((eid) => {
      let k = known.get(eid)
      if (!k || excluded.has(eid) || (k.num == null && !own.has(eid))) {
        return false
      }
      // Memory answers for an entity it knows wholly: one it knows wears an
      // exception, or one it knows wears none of them, is not asked about.
      let held = tables.map((name) => had?.(eid, name))
      if (held.includes(true)) excluded.add(eid)
      return !held.includes(true) && held.some((h) => h === undefined)
    })
    for (let eid of wears(driver, tables, asked)) excluded.add(eid)
    for (let eid of excluded) {
      if (known.get(eid)?.num == null) continue
      driver.query({
        t: 'update',
        table: 'entity',
        set: { num: lit(null) },
        where: and(eq(col('eid'), val(eid)), notNull(col('num'))),
      })
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
  let born: Entity[] = []
  let seen = new Set(known.keys())
  for (let eid of touched(vocab, alive)) {
    if (seen.has(eid)) continue
    seen.add(eid)
    let rows = driver.query({
      ...mintSql(eid, own.has(eid) && take(eid)),
      returning: [...IDENTITY, col('id')],
    })
    let e = minted(rows)
    if (rows[0]) {
      let id = Number(rows[0].id)
      ids.set(eid, id)
      spined(driver).learn(eid, {
        id,
        num: rows[0].num == null ? null : Number(rows[0].num),
        dead: false,
      })
    }
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
    for (let b of get(driver, vocab, pointed)) {
      let n = take(b.entity.eid)
      if (n === false || comps(b).length) continue
      let e = minted(driver.query(numberSql(b.entity.eid, n)))
      if (e) born.push(e)
    }
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
  let fresh = new Set(born.map((e) => e.eid))
  let lacks = (eid: string, name: string) =>
    fresh.has(eid) || had?.(eid, name) === false
  for (let b of alive) {
    let eid = b.entity.eid
    for (let [name, comp] of comps(b)) {
      if (comp != null && lacks(eid, name) && full(name, comp)) {
        effect(driver, upsertSql(vocab, eid, name, comp, false, resolve))
        moved?.(eid, name, true)
        continue
      }
      let { first, fallback } = patchOne(vocab, eid, name, comp, resolve)
      let changes = ran(driver, first)
      // A write's own result avoids the absent INSERT when UPDATE hit. D1
      // still sends the complete plan atomically via patchSql; no read/merge.
      if (fallback && !changes) changes = ran(driver, fallback())
      else if (fallback) continue
      if (changes) moved?.(eid, name, comp != null)
    }
  }

  // Metadata can classify a tombstone too; on its own it brings nothing back.
  for (let b of bundles) {
    for (let s of archetypeSql(b, ids)) effect(driver, s)
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
  return born
}

// How many rows a write changed: the driver's own count where it keeps one,
// else the rows the statement returns.
let ran = (driver: Driver, w: Insert | Update | Delete): number =>
  driver.run?.(w) ?? driver.query({ ...w, returning: [col('entity')] }).length

/** Whether memory says an entity holds a row of a component, read or written
 * before: `undefined` where memory does not know (./memo.ts). */
export type Known = (eid: string, name: string) => boolean | undefined

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
 * entities' pointers, ./archetype.ts `heldBy`); left out, it is every table the
 * vocabulary declares.
 */
export let remove = (
  driver: Driver,
  vocab: Vocab,
  entities: Entity[],
  held: string[] = tables(vocab),
): void => {
  let now = new Date().toISOString()
  for (let s of removeSql(held, entities, now)) effect(driver, s)
}
