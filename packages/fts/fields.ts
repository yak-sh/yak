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

// The default choice: every STORED text-shaped column. A computed column has no
// row to index, and a number, a stamp or a reference is not prose.
export let textual: Pick = (c) =>
  c.persist && c.category == 'scalar' &&
  (c.scalar == 'text' || c.scalar == 'body')

// The indexed fields of a vocabulary, by component then declaration order.
export let fields = (vocab: Vocab, pick: Pick = textual): Field[] =>
  vocab.all.flatMap((comp) =>
    vocab.columns(comp)
      .map((prop) => vocab.column(comp, prop)!)
      .filter(pick)
      .map((c) => ({ comp, prop: c.prop }))
  )

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
