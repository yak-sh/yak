// What the journal's rows call each word. A change records its component by
// the component's identity, the `$id` its vocabulary gives it (@yaks/vocab),
// which is the eid of the `_comp` row describing it, and each value by its
// property's identity, so a renamed word keeps its history. A word without an
// identity is recorded by its label.
//
// Rows written before identities name every word by its label. Both shapes
// are read alike, each to the label the vocabulary reads it by now, until
// every store's journal has been rewritten to identities (D-338's migration).

import { derivedEid } from '@yaks/graph/identity'
import { type Expr, fn, lit, op, val } from '@yaks/sql/core'
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
  /** {@link Names.label} in SQL, over a column holding the component a row
   * recorded */
  compLabelOf: (recorded: Expr) => Expr
  /** {@link Names.label} in SQL, over a column holding the property a row
   * recorded */
  propLabelOf: (recorded: Expr) => Expr
  /** the eid of the `_comp` row describing a component, in SQL, from what a
   * row recorded for it: its identity, or where its label derives where it
   * has none (@yaks/vocab `rowsOf`) */
  rowOf: (recorded: Expr) => Expr
}

let both = (label: string, id?: string) =>
  id && id != label ? [id, label] : [label]

// A lookup in a JSON object the statement binds, by a key read from a row;
// what it does not hold reads as itself. Bound, not written into the text: a
// whole vocabulary's names run to tens of kilobytes, and workerd refuses a
// statement past 100,000 characters but binds a value up to 8 MB.
let looked = (map: Record<string, string>) => {
  let text = val(JSON.stringify(map))
  return (key: Expr): Expr =>
    Object.keys(map).length
      ? fn(
        'coalesce',
        op('->>', text, op('||', op('||', lit('$."'), key), lit('"'))),
        key,
      )
      : key
}

let made = new WeakMap<Vocab, Names>()

/** The names `vocab`'s words are recorded by, and read back from. */
export let names = (vocab: Vocab): Names => {
  let got = made.get(vocab)
  if (got) return got
  let comps: Record<string, string> = {}
  let props: Record<string, string> = {}
  let ids: Record<string, string> = {}
  let rows: Record<string, string> = {}
  let at = rowsOf(vocab, derivedEid)
  for (let comp of vocab.all) {
    let id = vocab.comp(comp)?.id
    if (id) [comps[id], ids[comp]] = [comp, id]
    rows[comp] = at.comp(comp)
    for (let prop of vocab.props(comp)) {
      let p = vocab.prop(comp, prop)?.id
      if (p) props[p] = prop
    }
  }
  got = {
    comp: (label) => ids[label] ?? label,
    prop: (comp, label) => vocab.prop(comp, label)?.id ?? label,
    comps: (label) => both(label, ids[label]),
    props: (comp, label) => both(label, vocab.prop(comp, label)?.id),
    label: (recorded) => comps[recorded] ?? props[recorded] ?? recorded,
    compLabelOf: looked(comps),
    propLabelOf: looked(props),
    rowOf: looked(rows),
  }
  made.set(vocab, got)
  return got
}
