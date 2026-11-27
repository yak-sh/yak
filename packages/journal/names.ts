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

import { derivedEid } from '@yaks/graph/identity'
import {
  col,
  type Column,
  eq,
  type Expr,
  fn,
  lit,
  select,
  type Stmt,
  sub,
  table,
} from '@yaks/sql/core'
import { rowsOf, type Vocab } from '@yaks/vocab'

/** How the journal's rows name the words of one vocabulary. */
export type Names = {
  /** what a row records for a component, by its label */
  comp: (label: string) => string
  /** what a row records for a property, by its component's label and its */
  prop: (comp: string, label: string) => string
  /** every name a row may hold for a component: its identity and its label */
  comps: (label: string) => string[]
  /** every name a row may hold for a property: its identity and its label */
  props: (comp: string, label: string) => string[]
  /** the label a component or property a row recorded reads as */
  label: (recorded: string) => string
  /** {@link Names.label} in SQL, over a column holding what a row recorded */
  labelOf: (recorded: Expr) => Expr
  /** the eid of the `_comp` row describing a component, in SQL, from what a
   * row recorded for it: its identity, or where its label derives where it
   * has none (@yaks/vocab `rowsOf`) */
  rowOf: (recorded: Expr) => Expr
}

let both = (label: string, id?: string) =>
  id && id != label ? [id, label] : [label]

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
 * it has none, which reads as itself. */
export let words = (vocab: Vocab): Stmt[] => {
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
  let unique = [...new Map(rows.map((r) => [r[0], r])).values()]
  return [
    { t: 'delete', from: WORDS },
    ...Array.from(
      { length: Math.ceil(unique.length / BATCH) },
      (_, i): Stmt => ({
        t: 'insert',
        into: WORDS,
        cols: ['recorded', 'label', 'row'],
        rows: unique.slice(i * BATCH, (i + 1) * BATCH).map((r) => r.map(lit)),
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

let made = new WeakMap<Vocab, Names>()

/** The names `vocab`'s words are recorded by, and read back from. */
export let names = (vocab: Vocab): Names => {
  let got = made.get(vocab)
  if (got) return got
  let labels: Record<string, string> = {}
  let ids: Record<string, string> = {}
  for (let comp of vocab.all) {
    let id = vocab.comp(comp)?.id
    if (id) [labels[id], ids[comp]] = [comp, id]
    for (let prop of vocab.props(comp)) {
      let p = vocab.prop(comp, prop)?.id
      if (p) labels[p] = prop
    }
  }
  got = {
    comp: (label) => ids[label] ?? label,
    prop: (comp, label) => vocab.prop(comp, label)?.id ?? label,
    comps: (label) => both(label, ids[label]),
    props: (comp, label) => both(label, vocab.prop(comp, label)?.id),
    label: (recorded) => labels[recorded] ?? recorded,
    labelOf,
    rowOf,
  }
  made.set(vocab, got)
  return got
}
