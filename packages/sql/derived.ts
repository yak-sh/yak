// The derived-property hook. Some properties are declared in a vocabulary but
// never stored — a vocabulary marks them `computed: true` — because their value
// is computed from other rows by the application. @yaks/sql cannot know those
// formulas (they belong to the application, not to the schema), so the caller
// passes them in: a `Derived` map from `comp.prop` to the SQL expression that
// reads the value. This is what lets a computed property be filtered in SQL,
// through an index, instead of scanning every row in JavaScript.
//
// A `Derived` entry also works as a plain read override for a stored property
// that is read differently from how it is stored — for instance a property that
// falls back to another one when it was never written. The binder consults this
// map before the dialect's own lowering, so an override wins whether or not
// the property is `computed: true`.
//
// Example — a computed `order.total`, summed from the order's line items:
//
//   let total: DerivedProp = {
//     tag: 'number',
//     deps: [], // extra component tables the expression reads
//     expr: (owner) =>
//       sub(select({
//         cols: [fn('coalesce', fn('sum', col('amount', 'line')), lit(0))],
//         from: table('line'),
//         where: eq(col('order', 'line'), owner),
//       })),
//   }
//   compile(ast, vocab, { derived: { 'order.total': total } })

import type { Vocab } from '@yaks/vocab'
import {
  col,
  eq,
  exists,
  type Expr,
  fn,
  lit,
  notNull,
  op,
  type Select,
  select,
  table,
  when,
} from './ast.ts'
import { type Tag, tagOf } from './sqlite.ts'

// One derived property. `expr(owner)` builds the read expression, given the
// expression naming this entity's integer id (the row being selected, or the
// integer id a path dereferenced to); `tag` is the type a value is coerced to
// before it is compared; `values` optionally lists the enum members; `deps`
// names extra component tables the expression reads, which the binder must
// therefore left join.
export type DerivedProp = {
  tag: Tag
  values?: string[]
  deps?: string[]
  expr: (owner: Expr) => Expr
  // Reads a value that is being replaced, without looking up the owner row.
  // Full-text-search triggers have to read the old and new values, and by then
  // the owner row may already have changed or been deleted, so an expression
  // that starts from the owner cannot safely maintain their index.
  text?: (stored: Expr) => Expr
  // Whether the entity must have the component for this expression to return a
  // value. A qualified path names its component as much as its property, so by
  // default the binder reads this property as NULL for an entity without the
  // component — the same answer every stored property gives through its left
  // join. `false` means this expression returns a value for such an entity as
  // well: `updated.at` falling back to `created.at`, because being created is
  // the last time an untouched row changed. Defaults to true.
  worn?: boolean
}

// The registry a caller passes to `compile`, keyed by `comp.prop`. `compile`
// has no derived properties by default; an application with computed properties
// passes its own in.
export type Derived = Record<string, DerivedProp>

// ---- status ladders ----
//
// A component whose vocabulary declares a `status` ladder (@yaks/vocab
// ./status.ts) has a computed `status` no caller registers: it is read here,
// from the declaration, for every store. The value is a `case` over an
// `exists` per rung, in ladder order, falling through to the default; the
// binder's guard (./bind.ts `guarded`) makes it NULL for an entity without the
// component, as every read through a left join is.

// Does the entity `owner` names wear `comp`?
let wears = (comp: string, owner: Expr): Expr =>
  exists(select({
    cols: [lit(1)],
    from: table(comp, '__s'),
    where: eq(col('entity', '__s'), owner),
  }))

let laddered = new WeakMap<Vocab, Derived>()

/**
 * The status each ladder in this vocabulary gives, as SQL: one entry per
 * component declaring `status`, keyed `comp.status`.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { loadVocab } from '@yaks/vocab'
 * import { col, render } from '@yaks/sql'
 *
 * let v = loadVocab({ $defs: {
 *   job: { component: true, type: 'object',
 *     status: { failed: 'failed', default: 'pending' } },
 *   failed: { component: true, type: 'object' },
 * } })
 * let read = ladders(v)['job.status']
 * assertEquals(read.values, ['failed', 'pending'])
 * assertEquals(
 *   render(read.expr(col('entity', 'job'))).sql,
 *   'case when exists (select 1 from "failed" as "__s" where ' +
 *     `"__s"."entity" = "job"."entity") then 'failed' else 'pending' end`,
 * )
 * ```
 */
export let ladders = (v: Vocab): Derived => {
  let got = laddered.get(v)
  if (got) return got
  got = {}
  for (let comp of v.all) {
    let l = v.comp(comp)?.ladder
    let p = v.prop(comp, 'status')
    if (!l || !p) continue
    got[`${comp}.status`] = {
      tag: tagOf(p),
      values: p.values,
      expr: (owner) =>
        when(
          l.rungs.map((
            r,
          ): [Expr, Expr] => [wears(r.comp, owner), lit(r.status)]),
          lit(l.default),
        ),
    }
  }
  laddered.set(v, got)
  return got
}

let merged = new WeakMap<Vocab, WeakMap<Derived, Derived>>()
let made = new WeakSet<Derived>()

/**
 * The registry a store reads through: every ladder the vocabulary declares
 * ({@link ladders}), then the caller's own expressions, which win where both
 * name a property. The same object for the same two, so a cache keyed on the
 * registry keeps hitting.
 */
export let derivedOf = (v: Vocab, derived: Derived = {}): Derived => {
  if (made.has(derived)) return derived
  let byVocab = merged.get(v)
  if (!byVocab) merged.set(v, byVocab = new WeakMap())
  let got = byVocab.get(derived)
  if (!got) {
    byVocab.set(derived, got = { ...ladders(v), ...derived })
    made.add(got)
  }
  return got
}

/**
 * Whether a value a store reads for `comp.prop` means its entity wears `comp`:
 * a stored property's does, a derived one's does unless its expression answers
 * without the component (`worn: false`), and a computed property no
 * expression reads has no value to go by.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { loadVocab } from '@yaks/vocab'
 * import { lit } from '@yaks/sql'
 *
 * let vocab = loadVocab({ $defs: { page: { component: true, properties: {
 *   title: { type: 'string' },
 *   views: { type: 'number' },
 *   rank: { type: 'number', computed: true },
 *   seen: { type: 'number', computed: true },
 * } } } })
 * let wears = worn(vocab, {
 *   'page.rank': { tag: 'number', expr: () => lit(1) },
 *   'page.title': { tag: 'text', worn: false, expr: () => lit('') },
 * })
 * assertEquals(
 *   ['views', 'rank', 'title', 'seen'].map((p) => wears('page', p)),
 *   [true, true, false, false],
 * )
 * ```
 */
export let worn =
  (vocab: Vocab, derived: Derived = {}) =>
  (comp: string, prop: string): boolean => {
    let d = derivedOf(vocab, derived)[`${comp}.${prop}`]
    let p = vocab.prop(comp, prop)
    return d ? d.worn !== false : !!p && !p.computed
  }

// ---- whole components ----
//
// A component can be derived whole: a vocabulary marks it `computed: true`,
// and no table of its own holds it. Its rows are another package's (the
// journal's `_tx` and `_change` are its transactions and its changes), so that
// package supplies them as a `Backing`: one row per entity wearing the
// component, keyed by an integer `entity` column, a column per property —
// exactly the shape of a component table, so the binder and a gather read it
// the way they read a table.
//
// Its entities have no row in the entity table. A query that asks for the
// component therefore reads its rows as the spine instead (./spine.ts), and
// each entity's eid is its integer id written out ahead of the backing's
// `tag`: the eid is a function of the id, so nothing stores it and reading one
// back is arithmetic. The tag names the store and the component (@yaks/sqlite
// derives it from the store's epoch), so a record's eid names that record in
// that store and in no other.
//
//   id 42, tag 3f1c…(32 hex)   eid 0000002a3f1c…   40 hex characters
//
// The id leads, in at least eight hex digits, so the short handle a person
// reads (@yaks/id `short`, the first ten) tells two records apart, and the
// eid has the shape of a content address, which every door takes as an eid.

/** The rows a computed component is read from, and the tag its entities' eids
 * end with. The package that owns the rows supplies `rows`; the store that
 * reads them supplies `tag`. */
export type Backing = {
  /** one row per entity: its integer id as `entity`, a column per property */
  rows: Select
  /** what its eids end with ({@link eidOf}): 32 hex characters */
  tag?: string
}

/** Every computed component a store reads, keyed by component name. */
export type Backings = Record<string, Backing>

/** The eid of the backed entity `id` names under `tag`.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let tag = '3f1c9e0d7b5a4c2e8f6d1b3a5c7e9f0a'
 * assertEquals(eidOf(tag, 42), '0000002a3f1c9e0d7b5a4c2e8f6d1b3a5c7e9f0a')
 * assertEquals(idOf(tag, eidOf(tag, 42)), 42)
 * assertEquals(idOf(tag, eidOf(tag, 2 ** 40)), 2 ** 40)
 * assertEquals(idOf(tag, '4f0e2c1a-9b7d-4e3f-8a6b-5c4d3e2f1a0b'), null)
 * ```
 */
export let eidOf = (tag: string, id: number): string =>
  id.toString(16).padStart(8, '0') + tag

/** The integer id an eid names under `tag`, or null when it names none. Only
 * the one spelling {@link eidOf} writes is read, so an id has one eid. */
export let idOf = (tag: string, eid: string): number | null => {
  let head = eid.slice(0, -tag.length)
  return eid.endsWith(tag) && /^[0-9a-f]{8,}$/.test(head) &&
      (head.length == 8 || head[0] != '0')
    ? parseInt(head, 16)
    : null
}

/** {@link eidOf} in SQL, over the expression holding the id: null for a null
 * id, as a reference that names nothing reads. */
export let eidAt = (tag: string, id: Expr): Expr =>
  when([[notNull(id), op('||', fn('printf', lit('%08x'), id), lit(tag))]])
