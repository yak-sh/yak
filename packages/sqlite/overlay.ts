// The batch as a WORLD. A rule is a query, and a query reads tables — so for a
// rule to be judged against a batch that has not been written yet, the batch
// has to BE a table. This file makes it one: a `with` prefix of common table
// expressions, one per component the batch moved, each saying
//
//   the committed rows the batch did not touch    +    the batch's own rows
//
// and a rule's statement reads those names instead of the real ones. Nothing
// is created, nothing is dropped, and nothing outside the statement can see
// it: the overlay is part of the query, not a state the database is left in.
//
// It was temp tables shadowing the real ones once, which was neater to read
// and wrong in the one place it had to work: a Durable Object's SQLite refuses
// a temp object outright (`not authorized: SQLITE_AUTH`), and a rule that only
// runs on a server is not the rule this graph wanted. A CTE runs everywhere
// SQL does, and it took the shadowing hazard with it — while a temp table
// stood, an unqualified INSERT would have landed in it.
//
// A patch is a PATCH, so a touched row is the committed row with the patch
// folded in — merged here, once, rather than by every rule. A `comp: null`
// drops the component: the row is excluded from the committed arm and carries
// no row of its own. A deleted entity leaves the spine the same way, so every
// membership loses it.
//
// What DROPPED is a second reading of the same batch, and it needs its own
// table: once a row is out of the overlay, "it is not there" and "the batch
// took it" are the same silence, and `-comp` (@yaks/query) asks the second.
// So each dropped component gets a list of the entities it left — the only
// question here that a committed table can never answer, since the answer is
// exactly what is no longer in one. A tombstoned entity's own components are
// NOT enumerated: nothing matches a dead entity anyway (every statement here
// is `live()`-guarded), and what a bare tombstone carried is known to whoever
// read it before the batch, not to the batch.
//
// The SPINE is overlaid too, because a batch mints entities that have no
// integer id yet. They get a NEGATIVE one here — the id space storage hands
// out is positive, so the two can never collide — and every reference to a
// fresh entity resolves to it, which is what lets a rule join across two
// entities the same batch created.
//
// COST is a property of the batch, never of the database: the CTE names the
// committed table for everything it did not touch, so nothing is copied. Two
// statements and a handful of binds, whatever is already in the file. See
// overlay_test.ts, which measures it.
//
// The client seam, unbuilt on purpose: this shape is a query, so a browser
// that keeps its cache as tables could run the same compiled rule against the
// same overlay. Nothing here assumes a server — but nothing here builds that
// either.

import type { Vocab } from '@yaks/vocab'
import { type Bundle, comps, dead, type Eid } from '@yaks/graph'
import type { Driver, Param } from './driver.ts'

/** What an overlaid component's CTE is called. */
export let OVER = '_over_'
/** What the list of entities a batch DROPPED a component from is called. */
export let GONE = '_gone_'

/**
 * A batch, readable. `with` is the prefix a statement carries, `params` the
 * binds it consumes FIRST, and `at` names the source each component reads
 * from — the overlay's where there is one, the committed table where the
 * batch said nothing.
 */
export type Overlay = {
  /** the `with` prefix, ready to put in front of a select (`''` when the
   * batch moved nothing the caller asked about) */
  with: string
  /** the binds the prefix consumes, before the statement's own */
  params: Param[]
  /** the source a component reads from, quoted and ready to alias */
  at: (comp: string) => string
  /** the entities this batch removed a component from, as a source to select
   * an `entity` column from — `null` where the batch removed none */
  gone: (comp: string) => string | null
  /** the components this overlay covers */
  covers: string[]
  /** the integer id each eid reads as inside it */
  ids: Map<Eid, number>
}

let q = (name: string): string => `"${name.replaceAll('"', '""')}"`

// A component's stored columns, in the order the table carries them.
let stored = (v: Vocab, comp: string): string[] =>
  v.columns(comp).map((p) => v.column(comp, p)!).filter((c) => !c.computed)
    .map((c) => c.prop)

// The spine's own columns. Fixed, because the identity table is fixed (ddl.ts
// SPINE); `archetype` rides with it where the vocabulary knows one.
let SPINE = ['id', 'eid', 'num', 'archetype']

// What a column stores, the way ./write.ts lowers it: a boolean is 0/1, a
// reference is its target's integer id, everything else passes through.
let lower = (
  v: Vocab,
  comp: string,
  prop: string,
  value: unknown,
  ids: Map<Eid, number>,
): Param => {
  if (value == null) return null
  if (v.column(comp, prop)?.category == 'ref') {
    return ids.get(String(value)) ?? null
  }
  return typeof value == 'boolean' ? Number(value) : value as Param
}

// Every eid a batch names: the entities it is about, and the entities its
// reference columns point at. Both need an id, because a rule reads them the
// same way.
let named = (v: Vocab, bundles: Bundle[]): Eid[] => {
  let out = new Set<Eid>()
  for (let b of bundles) {
    out.add(b.entity.eid)
    for (let [comp, patch] of comps(b)) {
      if (!patch) continue
      for (let [prop, value] of Object.entries(patch)) {
        if (
          v.column(comp, prop)?.category == 'ref' && typeof value == 'string'
        ) {
          out.add(value)
        }
      }
    }
  }
  return [...out]
}

/**
 * Read a batch as tables.
 *
 * ```ts
 * let over = overlay(driver, vocab, batch, ['product'])
 * driver.query(over.with + sql, [...over.params, ...params])
 * ```
 */
export let overlay = (
  driver: Driver,
  vocab: Vocab,
  bundles: Bundle[],
  only?: readonly string[],
): Overlay => {
  let wanted = only && new Set(only)
  // Which components the batch moved. A component nobody touched needs no
  // overlay: the committed table is already the answer.
  let touched = new Map<string, Map<Eid, Record<string, unknown> | null>>()
  let dropped = new Map<string, Set<Eid>>()
  let killed = new Set<Eid>()
  let about = new Set<Eid>()
  for (let b of bundles) {
    about.add(b.entity.eid)
    if (dead(b)) killed.add(b.entity.eid)
    for (let [comp, patch] of comps(b)) {
      if (!vocab.comp(comp) || (wanted && !wanted.has(comp))) continue
      let rows = touched.get(comp) ?? new Map()
      let held = rows.get(b.entity.eid)
      // Dropped, and dropped LAST: a batch that removes a component and then
      // writes it again has not removed it, so the second patch takes the
      // entity back off the list the same way it puts the row back.
      if (patch == null) {
        dropped.set(comp, (dropped.get(comp) ?? new Set()).add(b.entity.eid))
      } else dropped.get(comp)?.delete(b.entity.eid)
      // Two patches for one entity in one batch compose, latest column wins.
      rows.set(
        b.entity.eid,
        patch == null ? null : { ...(held ?? {}), ...patch },
      )
      touched.set(comp, rows)
    }
  }

  // Every id the overlay speaks in. A committed entity keeps the one storage
  // gave it; a fresh one is numbered DOWNWARD from zero, where nothing else
  // ever is.
  let ids = new Map<Eid, number>()
  let eids = named(vocab, bundles)
  for (let i = 0; i < eids.length; i += 500) {
    let chunk = eids.slice(i, i + 500)
    for (
      let row of driver.query(
        `select id, eid from entity where eid in (${
          chunk.map(() => '?').join(', ')
        })`,
        chunk,
      )
    ) ids.set(String(row.eid), Number(row.id))
  }
  let next = 0
  let fresh: Eid[] = []
  for (let eid of eids) {
    if (ids.has(eid)) continue
    ids.set(eid, --next)
    if (about.has(eid)) fresh.push(eid)
  }

  let parts: string[] = []
  let params: Param[] = []
  let covers: string[] = []
  // One component's arm: the committed rows it did not touch, then its own.
  let arm = (
    comp: string,
    cols: string[],
    key: string,
    from: string,
    out: number[],
    rows: Param[][],
  ) => {
    let list = [key, ...cols].map(q).join(', ')
    let sql = `select ${list} from ${from}`
    if (out.length) {
      sql += ` where ${q(key)} not in (${out.map(() => '?').join(', ')})`
      params.push(...out)
    }
    if (rows.length) {
      sql += ` union all values ${
        rows.map(() => `(${[key, ...cols].map(() => '?').join(', ')})`).join(
          ', ',
        )
      }`
      for (let row of rows) params.push(...row)
    }
    parts.push(`${q(OVER + comp)} as (${sql})`)
    covers.push(comp)
  }

  for (let [comp, rows] of touched) {
    let cols = stored(vocab, comp)
    let owners = [...rows.keys()].map((e) => ids.get(e)!).filter((id) => id > 0)
    // The committed row a patch folds into, read once per component.
    let held = new Map<number, Record<string, unknown>>()
    if (owners.length) {
      for (
        let row of driver.query(
          `select entity, ${cols.map(q).join(', ')} from ${q(comp)} ` +
            `where entity in (${owners.map(() => '?').join(', ')})`,
          owners,
        )
      ) held.set(Number(row.entity), row)
    }
    arm(
      comp,
      cols,
      'entity',
      q(comp),
      [...rows.keys()].map((e) => ids.get(e)!),
      [...rows].flatMap(([eid, patch]) => {
        if (!patch) return []
        let id = ids.get(eid)!
        let was = held.get(id) ?? {}
        return [[
          id,
          ...cols.map((c) =>
            c in patch
              ? lower(vocab, comp, c, patch[c], ids)
              : (was[c] ?? null) as Param
          ),
        ]]
      }),
    )
  }

  // The spine, where the batch moved it: a batch that patches entities that
  // all exist already leaves the identity table alone.
  if (fresh.length || killed.size) {
    let cols = (vocab.comp('archetype') ? SPINE : SPINE.slice(0, 3)).slice(1)
    arm(
      'entity',
      cols,
      'id',
      q('entity'),
      [...killed].map((e) => ids.get(e)!),
      fresh.map((
        eid,
      ) => [ids.get(eid)!, eid, null, ...cols.slice(2).map(() => null)]),
    )
  }

  // What the batch took, one list per component. A literal `values` list, not
  // a select: these rows are the batch's own, and there is nothing committed
  // left to read them from.
  let took = new Set<string>()
  for (let [comp, eids] of dropped) {
    let rows = [...eids].map((e) => ids.get(e)!).filter((id) => id != null)
    if (!rows.length) continue
    parts.push(
      `${q(GONE + comp)}("entity") as (values ${
        rows.map(() => '(?)').join(', ')
      })`,
    )
    params.push(...rows)
    took.add(comp)
  }

  let over = new Set(covers)
  return {
    with: parts.length ? `with ${parts.join(', ')} ` : '',
    params,
    at: (comp) => over.has(comp) ? q(OVER + comp) : q(comp),
    gone: (comp) => took.has(comp) ? q(GONE + comp) : null,
    covers,
    ids,
  }
}
