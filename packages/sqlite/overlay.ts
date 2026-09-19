// The batch as a WORLD. A rule is a query, and a query reads tables — so for a
// rule to be judged against a batch that has not been written yet, the batch
// has to BE a table. This file makes it one: every component the batch touches
// gets a temp table holding the batch's own rows, and a temp VIEW of the
// component's name over `main`'s rows minus the ones the batch moved, unioned
// with those. SQLite resolves an unqualified name in `temp` before `main`, so
// every compiled statement — the very same SQL, from the very same dialect —
// reads the overlay instead of the committed tables while it stands.
//
// That shadowing is the whole mechanism, and the reason there is no second
// compiler: @yaks/sql never learns that an overlay exists. It is also why the
// overlay's life is a BRACKET (`{ drop }`, always in a `finally`): while it
// stands, an unqualified INSERT would land in the temp table, so nothing
// writes between raising it and dropping it. Rules read; `mutate` writes after.
//
// What the view says, per component:
//
//   committed rows the batch did not touch    +    the batch's rows
//
// A patch is a PATCH, so a touched row is the committed row with the patch
// folded in — merged here, once, rather than by every rule. A `comp: null`
// drops the component: the row is excluded from the committed arm and carries
// no row of its own (`__gone`). A deleted entity leaves the spine overlay the
// same way, so every membership loses it.
//
// The SPINE is overlaid too, because a batch mints entities that have no
// integer id yet. They get a NEGATIVE one here — the id space storage hands
// out is positive, so the two can never collide — and every reference to a
// fresh entity resolves to it, which is what lets a rule join across two
// entities the same batch created.
//
// COST is a property of the batch, never of the database: the temp tables hold
// the batch's rows and the views name `main` for the rest, so nothing is
// copied. See overlay_test.ts, which measures it.
//
// The client seam, unbuilt on purpose: these overlay tables are the shape a
// browser cache already keeps, so the same compiled rule could run locally
// against a local overlay. Nothing here assumes a server — but nothing here
// builds that either.

import type { Vocab } from '@yaks/vocab'
import { type Bundle, comps, dead, type Eid } from '@yaks/graph'
import { type Driver, effect, type Param } from './driver.ts'

/** The prefix a batch's own rows are held under, in `temp`. */
export let OVER = '_over_'

/** The column that says a row is the batch REMOVING something rather than
 * writing it. Two underscores: a component column is a plain identifier, so
 * this cannot be one. */
export let GONE = '__gone'

/** A standing overlay: what it covers, how a fresh entity was numbered, and
 * the way down. `drop` is idempotent and belongs in a `finally`. */
export type Overlay = {
  /** the components it shadows, `entity` included */
  covers: string[]
  /** the integer id each eid reads as while the overlay stands */
  ids: Map<Eid, number>
  /** take it down: every temp view and table this raised */
  drop: () => void
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
 * Raise an overlay over a batch: the temp tables that hold it and the views
 * that shadow the committed ones. Every read through this driver sees the
 * graph WITH the batch in it until `drop()`.
 *
 * ```ts
 * let over = overlay(driver, vocab, batch)
 * try {
 *   // every compiled query here reads the batch as though it had landed
 * } finally {
 *   over.drop()
 * }
 * ```
 */
export let overlay = (
  driver: Driver,
  vocab: Vocab,
  bundles: Bundle[],
  only?: readonly string[],
): Overlay => {
  // Raising a table is DDL, and DDL makes SQLite re-prepare every statement it
  // holds — so the overlay covers what will be READ and nothing else. `only`
  // is that list (a rule set's components); without it the whole batch is
  // covered, which is what a caller asking for the batch itself wants.
  let wanted = only && new Set(only)
  // Which components the batch moved. A component nobody touched needs no
  // shadow: the committed table is already the answer.
  let touched = new Map<string, Map<Eid, Record<string, unknown> | null>>()
  let gone = new Set<Eid>()
  let about = new Set<Eid>()
  for (let b of bundles) {
    about.add(b.entity.eid)
    if (dead(b)) gone.add(b.entity.eid)
    for (let [comp, patch] of comps(b)) {
      if (!vocab.comp(comp) || (wanted && !wanted.has(comp))) continue
      let rows = touched.get(comp) ?? new Map()
      let held = rows.get(b.entity.eid)
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
        `select id, eid from main.entity where eid in (${
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

  let raised: string[] = []
  let made: string[] = []
  let drop = () => {
    for (let name of raised.splice(0)) driver.exec(`drop view temp.${q(name)}`)
    for (let name of made.splice(0)) driver.exec(`drop table temp.${q(name)}`)
  }

  // One component's half of the overlay: the temp table, its rows, the view.
  let cover = (comp: string, cols: string[], key: string, rows: Param[][]) => {
    let table = OVER + comp
    let all = [key, ...cols]
    driver.exec(
      `create temp table ${q(table)} (${
        all.map((c) => `${q(c)} integer`).join(', ')
      }, ${q(GONE)} integer not null default 0)`,
    )
    made.push(table)
    if (rows.length) {
      let holes = `(${all.map(() => '?').join(', ')}, ?)`
      effect(
        driver,
        `insert into temp.${q(table)} (${all.map(q).join(', ')}, ${
          q(GONE)
        }) values ${rows.map(() => holes).join(', ')}`,
        rows.flat(),
      )
    }
    let list = all.map(q).join(', ')
    driver.exec(
      `create temp view ${q(comp)} as ` +
        `select ${list} from main.${q(comp)} where ${q(key)} not in ` +
        `(select ${q(key)} from temp.${q(table)}) ` +
        `union all select ${list} from temp.${q(table)} where ${q(GONE)} = 0`,
    )
    raised.push(comp)
  }

  try {
    // A temp table's declared affinity does not decide what it holds (SQLite
    // stores what it is given), and the view's arms are unioned by position,
    // so every column is raised the same way and the committed arm supplies
    // the affinity that matters.
    for (let [comp, rows] of touched) {
      let cols = stored(vocab, comp)
      let owners = [...rows.keys()].map((e) => ids.get(e)!).filter((id) =>
        id > 0
      )
      // The committed row a patch folds into, read once per component.
      let held = new Map<number, Record<string, unknown>>()
      if (owners.length) {
        for (
          let row of driver.query(
            `select entity, ${cols.map(q).join(', ')} from main.${q(comp)} ` +
              `where entity in (${owners.map(() => '?').join(', ')})`,
            owners,
          )
        ) held.set(Number(row.entity), row)
      }
      cover(
        comp,
        cols,
        'entity',
        [...rows].map(([eid, patch]) => {
          let id = ids.get(eid)!
          if (!patch) return [id, ...cols.map(() => null), 1]
          let was = held.get(id) ?? {}
          return [
            id,
            ...cols.map((c) =>
              c in patch
                ? lower(vocab, comp, c, patch[c], ids)
                : (was[c] ?? null) as Param
            ),
            0,
          ]
        }),
      )
    }
    // The spine last, so the component views above read `main.entity` for the
    // rows they were built from and this one for every read after — and only
    // where the batch moved it: a batch that patches entities that all exist
    // already leaves the identity table alone.
    if (!fresh.length && !gone.size) {
      return { covers: [...touched.keys()], ids, drop }
    }
    let spine = vocab.comp('archetype') ? SPINE : SPINE.slice(0, 3)
    cover(
      'entity',
      spine.slice(1),
      'id',
      [
        ...fresh.map((eid) =>
          [
            ids.get(eid)!,
            eid,
            null,
            ...(spine.length > 3 ? [null] : []),
          ] as Param[]
        ).map((r) => [...r, 0] as Param[]),
        ...[...gone].map((eid) =>
          [
            ids.get(eid)!,
            null,
            null,
            ...(spine.length > 3 ? [null] : []),
            1,
          ] as Param[]
        ),
      ],
    )
  } catch (e) {
    drop()
    throw e
  }
  return { covers: [...touched.keys(), 'entity'], ids, drop }
}
