// Writes: bundles patched into the store, and entities removed from it. This
// is the PATCH half of the adapter — the mirror image of the reads in
// ./read.ts — and it honors the rules a graph patch honors everywhere:
//
//   omitted columns are untouched       a patch names only what changes
//   a column set to null is cleared     null is a value, not an absence
//   a component set to null is dropped  the row goes, the entity stays
//   a tombstoned entity takes no patch  deletion is final; ids never recycle
//
// Every write here is a statement, built before it is sent, and every statement
// is self-sufficient: an owner id is a subquery (`select id from entity where
// eid = ?`) rather than a value looked up first, and an insert whose owner does
// not exist writes nothing instead of inventing a row. Nothing is read between
// two writes.
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
import { type Driver, effect, type Param, type Row } from './driver.ts'
import { componentTables } from './physical.ts'
import { isJsonb, jsonIn } from './jsonb.ts'

/** One statement of a write: the SQL, and the parameters it binds. This file
 * builds them; an adapter runs them — one at a time over an embedded engine,
 * gathered into a single batch over a remote one. */
export type Sql = { sql: string; params: Param[] }

// The owner's integer id, as a subquery. Every write keys to it, so an entity
// minted earlier in the same unit of work resolves without a second question.
let OWNER = '(select id from entity where eid = ?)'

// Run a built statement for effect, discarding any rows.
let run = (driver: Driver, s: Sql): void => effect(driver, s.sql, s.params)

// The value a column stores, coerced to what SQLite holds: a boolean becomes
// 0/1 (a bool column has integer affinity), everything else passes through. A
// reference is resolved to its target's integer id by the statement itself.
let scalar = (value: unknown): Param =>
  typeof value == 'boolean' ? Number(value) : value as Param

// Whether a column is a reference — asked of the vocabulary, which knows a
// column's category.
let isRef = (v: Vocab, comp: string, prop: string): boolean =>
  v.prop(comp, prop)?.category == 'ref'

// One column's value as the SQL that writes it and the parameter it binds: a
// reference names its target's eid and the statement looks up the id, a JSON
// value goes in through `jsonb()` (./jsonb.ts), and a scalar is bound as it is.
let slot = (
  v: Vocab,
  comp: string,
  prop: string,
  raw: unknown,
): { sql: string; param: Param } =>
  raw != null && isRef(v, comp, prop)
    ? { sql: OWNER, param: String(raw) }
    : isJsonb(v, comp, prop)
    ? { sql: 'jsonb(?)', param: jsonIn(raw) }
    : { sql: '?', param: scalar(raw) }

/** What the store already knows about an eid: whether that identity is
 * tombstoned. An eid with no entry has no entity yet. */
export type Spine = { dead: boolean }

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
    driver.query(
      `select e.eid as eid, t.entity as dead from entity e
        left join tombstone t on t.entity = e.id
        where e.eid in (select value from json_each(?))`,
      [JSON.stringify(eids)],
    ).map((r) => [String(r.eid), { dead: r.dead != null }]),
  )
}

/** The entities that are tombstoned, of those named. */
export let buried = (driver: Driver, eids: string[]): Set<string> =>
  new Set(
    [...spines(driver, eids)]
      .filter(([, spine]) => spine.dead)
      .map(([eid]) => eid),
  )

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
export let mintSql = (eid: string, number: boolean | number = false): Sql => ({
  sql: `insert into entity (eid, num)
          values (?, ${
    typeof number == 'number'
      ? '?'
      : number
      ? '(select high + 1 from entity_sequence where singleton = 1)'
      : 'null'
  })
          on conflict(eid) do nothing returning eid, num`,
  params: typeof number == 'number' ? [eid, number] : [eid],
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

/**
 * The statement that patches one component onto one entity: insert the sent
 * columns, or update just them on conflict, so an omitted column keeps what it
 * held. A reference column binds its target's eid and resolves to that target's
 * id in the statement. A component whose patch names no stored column is a tag
 * — its row's existence is the whole fact.
 *
 * An INSERT…select is what makes the owner a subquery: no owner row, no
 * inserted row. Its WHERE is also what lets SQLite parse the upsert clause.
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
): Sql => {
  let cols = Object.keys(patch).filter((c) =>
    v.prop(comp, c)?.computed === false
  )
  if (!cols.length) {
    return {
      sql: `insert or ignore into "${comp}" (entity)
              select id from entity e where eid = ?${
        absent
          ? ` and not exists (select 1 from "${comp}" where entity = e.id)`
          : ''
      }`,
      params: [eid],
    }
  }
  // The value each column takes, as a select item beside the owner id: a
  // reference is another subquery, a scalar is a bound parameter.
  let params: Param[] = []
  let items = cols.map((c) => {
    let s = slot(v, comp, c, patch[c])
    params.push(s.param)
    return s.sql
  })
  let names = cols.map((c) => `"${c}"`).join(', ')
  let sets = cols.map((c) => `"${c}" = excluded."${c}"`).join(', ')
  return {
    sql: `insert into "${comp}" (entity, ${names})
            select e.id, ${items.join(', ')} from entity e where e.eid = ?
            ${
      absent
        ? `and not exists (select 1 from "${comp}" where entity = e.id)`
        : `on conflict(entity) do update set ${sets}`
    }`,
    params: [...params, eid],
  }
}

/** The statement that drops one component from one entity — the row goes, the
 * entity stays. */
export let dropSql = (eid: string, comp: string): Sql => ({
  sql: `delete from "${comp}" where entity = ${OWNER}`,
  params: [eid],
})

/** The identity metadata write, using the portable eid as an integer lookup. */
export let archetypeSql = (b: Bundle): Sql[] =>
  b.entity.archetype === undefined ? [] : [{
    sql: `update entity set archetype = ${OWNER} where eid = ?`,
    params: [b.entity.archetype, b.entity.eid],
  }]

/**
 * The statements that patch one bundle in: a plan per component it names, a drop
 * for each `null` one. Identity is minted separately (see {@link mintSql}),
 * because a batch mints every eid it touches or points at before it writes
 * anything.
 */
export let patchSql = (v: Vocab, b: Bundle): Sql[] => [
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
): { first: Sql; fallback?: () => Sql } => {
  if (comp == null) return { first: dropSql(eid, name) }
  // Insert checks NOT NULL before ON CONFLICT. Update existing rows first,
  // then insert only absent ones: partial patches need no invented defaults
  // or read/merge, and the same ordered statements work in a D1 batch.
  let cols = Object.keys(comp).filter((c) =>
    v.prop(name, c)?.computed === false
  )
  let params: Param[] = []
  let sets = cols.map((c) => {
    let s = slot(v, name, c, comp[c])
    params.push(s.param)
    return `"${c}" = ${s.sql}`
  })
  let fallback = () => upsertSql(v, eid, name, comp, true)
  return cols.length
    ? {
      first: {
        sql: `update "${name}" set ${sets.join(', ')} where entity = ${OWNER}`,
        params: [...params, eid],
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
export let removeSql = (v: Vocab, entity: Entity, at: string): Sql[] => [
  ...[...v.all].reverse()
    .filter((comp) => comp != 'entity')
    .map((comp) => dropSql(entity.eid, comp)),
  {
    sql: `insert or ignore into tombstone (entity, deleted_at)
            select id, ? from entity where eid = ?`,
    params: [at, entity.eid],
  },
]

/** Every eid these bundles touch or point at, in first-touch order — each
 * bundle's own entity, then the targets of its reference columns. This is the
 * order identity is minted in, so it is the order `num` follows. */
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
 * Patch a batch of bundles in, in order, and return the entities this patch
 * minted — each with the `num` it was given, as the minting insert itself
 * reported it. A bundle for a tombstoned entity is skipped: death is final.
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
    for (let name of number.except) {
      let table = '"' + name.replaceAll('"', '""') + '"'
      for (let b of alive) {
        if (!known.has(b.entity.eid)) continue
        if (
          driver.query(
            'select 1 from ' + table +
              ' c join entity e on e.id = c.entity where e.eid = ?',
            [b.entity.eid],
          ).length
        ) excluded.add(b.entity.eid)
      }
      for (let b of alive) if (b[name] != null) excluded.add(b.entity.eid)
    }
    for (let eid of excluded) {
      if (!known.has(eid)) continue
      driver.query(
        'update entity set num = null where eid = ? and num is not null',
        [eid],
      )
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
  let born: Entity[] = []
  let seen = new Set(known.keys())
  for (let eid of touched(vocab, alive)) {
    if (seen.has(eid)) continue
    seen.add(eid)
    let mine = number !== false && !excluded.has(eid)
    let take = !mine
      ? false
      : !stated.has(eid)
      ? true
      : stated.get(eid) ?? false
    let s = mintSql(eid, take)
    let e = minted(driver.query(s.sql, s.params))
    if (e) born.push(e)
  }

  for (let b of alive) {
    for (let [name, comp] of comps(b)) {
      let { first, fallback } = patchOne(vocab, b.entity.eid, name, comp)
      let changes = driver.run?.(first.sql, first.params)
      if (changes === undefined) {
        changes = driver.query(
          first.sql + (fallback ? ' returning entity' : ''),
          first.params,
        ).length
      }
      // A write's own result avoids the absent INSERT when UPDATE hit. D1
      // still sends the complete plan atomically via patchSql; no read/merge.
      if (fallback && !changes) {
        run(driver, fallback())
      }
    }
  }

  // Metadata can classify a tombstone too; it does not resurrect components.
  for (let b of bundles) for (let s of archetypeSql(b)) run(driver, s)
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
    let statements = removeSql(vocab, e, now)
    if (physical) {
      statements = [
        ...physical.filter((n) => n != 'tombstone').map((n) => ({
          sql: `delete from "${
            n.replaceAll('"', '""')
          }" where entity = ${OWNER}`,
          params: [e.eid],
        })),
        statements.at(-1)!,
      ]
    }
    for (let s of statements) run(driver, s)
  }
}
