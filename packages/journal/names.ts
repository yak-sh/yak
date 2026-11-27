// What the journal's rows call each word. A change records its component by
// the component's identity, the `$id` its vocabulary gives it (@yaks/vocab),
// which is the eid of the `_comp` row describing it, and each value by its
// property's identity, so a renamed word keeps its history. A word without an
// identity is recorded by its label.
//
// Rows written before identities name every word by its label. Both shapes
// are read alike, each to the label the vocabulary reads it by now, until
// every store's journal has been rewritten to identities (D-338's migration).
//
// A statement reads a label from `journal_word`, the store's rows for the
// names its vocabulary gives (`words`), which the journal's schema writes
// whenever the vocabulary changes (./log.ts `ddl`). The vocabulary is never
// written into a statement: the platform's is tens of kilobytes, and workerd
// refuses a statement past 100,000 bytes (@yaks/sql `LENGTH`).
//
// Labels are read back in the reader's namespace: `names(vocab.in(ns))` gives
// each component the label that namespace reads it by (@yaks/vocab, "Reading
// in a namespace"). `journal_word` holds the store's own labels, so a reading
// writes into its statements only the components it labels otherwise: none
// for the store's own reading, and few for any other, since only a label two
// namespaces share reads differently. A property's label is the same in every
// reading.

import { derivedEid } from '@yaks/graph/identity'
import {
  col,
  type Column,
  eq,
  type Expr,
  fn,
  lit,
  type Query,
  select,
  type Stmt,
  sub,
  table,
  unionAll,
  when,
} from '@yaks/sql/core'
import { rowsOf, type Vocab } from '@yaks/vocab'

/** How the journal's rows name the words of one vocabulary. */
export type Names = {
  /** what a row records for a component, by its label */
  comp: (label: string) => string
  /** what a row records for a property, by its component's label and its */
  prop: (comp: string, label: string) => string
  /** every name a row may hold for a component: its identity and its labels */
  comps: (label: string) => string[]
  /** every name a row may hold for a property: its identity and its label */
  props: (comp: string, label: string) => string[]
  /** the label a component a row recorded reads as */
  compLabel: (recorded: string) => string
  /** the label a property a row recorded reads as */
  propLabel: (recorded: string) => string
  /** {@link Names.compLabel} in SQL, over a column holding what a row
   * recorded */
  compLabelOf: (recorded: Expr) => Expr
  /** {@link Names.propLabel} in SQL */
  propLabelOf: (recorded: Expr) => Expr
  /** the eid of the `_comp` row describing a component, in SQL, from what a
   * row recorded for it: its identity, or where its label derives where it
   * has none (@yaks/vocab `rowsOf`) */
  rowOf: (recorded: Expr) => Expr
  /** every name a row may hold for the component the `_comp` row whose eid
   * is `row` describes, in SQL: the inverse of {@link Names.rowOf}, as a set
   * an index on what rows recorded can seek */
  recordedAt: (row: Expr) => Query
}

let unique = (
  names: (string | undefined)[],
) => [...new Set(names.filter((n): n is string => !!n))]

/** The table naming each word a journal's rows may record: `recorded`, what
 * a row holds for it, its `label`, and for a component the eid of its `_comp`
 * row. */
export let WORDS = 'journal_word'

let text = (name: string, notNull = false): Column => ({
  name,
  type: 'text',
  notNull,
})

/** {@link WORDS}, keyed by what a row recorded. */
export let wordTable: Stmt = {
  t: 'create table',
  name: WORDS,
  ifNot: true,
  cols: [
    { ...text('recorded', true), pk: true },
    text('label', true),
    text('row'),
  ],
  withoutRowid: true,
}

// The rows of one insert: three literals each, so a statement stays well
// short of workerd's length, and its text, the print a store installs by,
// changes when a word does.
let BATCH = 200

/** The statements writing `vocab`'s words into {@link WORDS}, after what
 * stood there: each component by its identity and by its label, each
 * property by its identity. A property's label is what a row recorded where
 * it has none, which reads as itself. The labels are the store's own, however
 * `reading` reads them. */
export let words = (reading: Vocab): Stmt[] => {
  let vocab = reading.in()
  let at = rowsOf(vocab, derivedEid)
  let rows: [string, string, string | null][] = []
  for (let comp of vocab.all) {
    let id = vocab.comp(comp)?.id, row = at.comp(comp)
    rows.push([comp, comp, row])
    if (id && id != comp) rows.push([id, comp, row])
    for (let prop of vocab.props(comp)) {
      let p = vocab.prop(comp, prop)?.id
      if (p && p != prop) rows.push([p, prop, null])
    }
  }
  let once = [...new Map(rows.map((r) => [r[0], r])).values()]
  return [
    { t: 'delete', from: WORDS },
    ...Array.from(
      { length: Math.ceil(once.length / BATCH) },
      (_, i): Stmt => ({
        t: 'insert',
        into: WORDS,
        cols: ['recorded', 'label', 'row'],
        rows: once.slice(i * BATCH, (i + 1) * BATCH).map((r) => r.map(lit)),
      }),
    ),
  ]
}

// A word's `column` in WORDS, by what a row recorded; what it does not hold
// reads as itself.
let looked = (column: string) => (key: Expr): Expr =>
  fn(
    'coalesce',
    sub(select({
      cols: [col(column, '__w')],
      from: table(WORDS, '__w'),
      where: eq(col('recorded', '__w'), key),
    })),
    key,
  )
let labelOf = looked('label'), rowOf = looked('row')

let recordedAt = (row: Expr): Query =>
  unionAll(
    select({
      cols: [col('recorded', '__r')],
      from: table(WORDS, '__r'),
      where: eq(col('row', '__r'), row),
    }),
    select({ cols: [row] }),
  )

let made = new WeakMap<Vocab, Names>()

/** The names `vocab`'s words are recorded by, and read back from, in the
 * labels `vocab` reads them by. */
export let names = (vocab: Vocab): Names => {
  let got = made.get(vocab)
  if (got) return got
  let own = vocab.in()
  // The label each recorded name reads as: each identity, and each of the
  // store's labels this reading gives another (`turned`, which `heldAs` maps
  // back, since a row recorded by label holds the store's).
  let comps: Record<string, string> = {}
  let props: Record<string, string> = {}
  let turned: [string, string][] = []
  let heldAs: Record<string, string> = {}
  for (let comp of own.all) {
    let id = own.comp(comp)?.id, word = id ? vocab.word(id) : undefined
    let as = word && 'comp' in word ? word.comp : comp
    if (id) comps[id] = as
    if (id && as != comp) {
      comps[comp] = as
      heldAs[as] = comp
      turned.push([id, as], [comp, as])
    }
    for (let prop of own.props(comp)) {
      let p = own.prop(comp, prop)?.id
      if (p) props[p] = prop
    }
  }
  let compLabelOf = turned.length
    ? (key: Expr) =>
      when(turned.map(([k, as]) => [eq(key, lit(k)), lit(as)]), labelOf(key))
    : labelOf
  let idOf = (label: string) => vocab.comp(label)?.id
  got = {
    comp: (label) => idOf(label) ?? label,
    prop: (comp, label) => vocab.prop(comp, label)?.id ?? label,
    comps: (label) => unique([idOf(label), label, heldAs[label]]),
    props: (comp, label) => unique([vocab.prop(comp, label)?.id, label]),
    compLabel: (recorded) => comps[recorded] ?? recorded,
    propLabel: (recorded) => props[recorded] ?? recorded,
    compLabelOf,
    propLabelOf: labelOf,
    rowOf,
    recordedAt,
  }
  made.set(vocab, got)
  return got
}
