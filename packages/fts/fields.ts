// WHICH text is searchable. Search here is not welded to one "document"
// component: a vocabulary declares components, some of their columns hold prose,
// and every one of those can be indexed. This module is the choice — a `Field`
// is one `comp.prop` pair, `fields()` reads them off a vocabulary, and a `Pick`
// narrows that default when an application wants only some of them.
//
// The fields are grouped into one INDEX PER COMPONENT (`indexes()`), because an
// FTS5 external-content index mirrors exactly one table.

import type { Column, Vocab } from '@yaks/vocab'

// A `comp.prop` pair naming one indexed text property — a book's title, a
// review's prose, a shop's own description.
export type Field = { comp: string; prop: string }

// Decides whether a column is indexed. An application passes its own to index
// less than everything textual — say, titles only.
export type Pick = (column: Column) => boolean

// The default choice: every STORED text column. A computed column has no row to
// index, and a number, a stamp or a reference is not prose.
export let textual: Pick = (c) =>
  c.persist && c.category == 'scalar' && c.scalar == 'text'

// The indexed fields of a vocabulary, by component then declaration order.
export let fields = (vocab: Vocab, pick: Pick = textual): Field[] =>
  vocab.all.flatMap((comp) =>
    vocab.columns(comp)
      .map((prop) => vocab.column(comp, prop)!)
      .filter(pick)
      .map((c) => ({ comp, prop: c.prop }))
  )

// How a STORED column reads as the text to index, keyed `comp.prop`: given SQL
// naming the stored value, the entry answers SQL naming the words it stands
// for. A column with no entry indexes as it stands, which is every ordinary
// text column.
//
// It exists because a value is not always its own text: @yaks/blob swaps a body
// for its SHA-256 and keeps the prose in a store beside the rows, so a trigger
// reading the column would index the address. `blobText(vocab)` is a map of
// this shape, and the type is declared structurally here so this package
// depends on nothing to accept one.
export type Text = Record<string, (stored: string) => string>

// One component's search index: the component it mirrors and the columns it
// covers, in the order they are declared to FTS5.
export type Index = { comp: string; props: string[] }

// The fields grouped into indexes, one per component, first-seen order kept.
export let indexes = (fields: Field[]): Index[] => {
  let by = new Map<string, string[]>()
  for (let f of fields) by.set(f.comp, [...(by.get(f.comp) ?? []), f.prop])
  return [...by].map(([comp, props]) => ({ comp, props }))
}

// The name of the index mirroring a component: `book` → `book_fts`.
export let indexName = (comp: string): string => `${comp}_fts`

// The name of the view a component reads as TEXT: `doc` → `doc_text`. It exists
// only for a component some of whose indexed columns resolve (see {@link Text});
// an index whose columns are their own text mirrors the table itself.
export let textName = (comp: string): string => `${comp}_text`
