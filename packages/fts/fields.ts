// Which text is searchable. Search is not limited to a single "document"
// component: a vocabulary declares components, some of their properties hold
// prose, and any of those can be indexed. This module makes that selection — a
// `Field` is one `comp.prop` pair, `fields()` reads them off a vocabulary, and
// a `Pick` narrows the default when an application wants only some of them.
//
// The fields are grouped into one index per component (`indexes()`), because an
// FTS5 external-content index mirrors exactly one table.

import type { Prop, Vocab } from '@yaks/vocab'

// A `comp.prop` pair naming one indexed text property — a book's title, a
// review's prose, a shop's own description.
export type Field = { comp: string; prop: string }

// Decides whether a property is indexed. An application passes its own to index
// less than the vocabulary marked — say, titles only.
export type Pick = (prop: Prop) => boolean

// The default selection: the properties the vocabulary marked searchable with
// `"search": true` (@yaks/vocab). Deciding which prose is worth finding belongs
// to the vocabulary, not to this package: a repository path and a provider name
// are text nobody goes looking for, and indexing them only adds terms a search
// has to wade through. A vocabulary that marks none has nothing to search.
//
// The storage checks stand beside that mark because an index is created from a
// table: a computed property has no stored value to index, and a number or an
// entity reference holds no words even if the vocabulary marked it.
export let searched: Pick = (c) =>
  c.search && !c.computed && c.category == 'scalar' && c.scalar == 'text'

// The searchable fields of a vocabulary, by component then declaration order.
export let fields = (vocab: Vocab, pick: Pick = searched): Field[] =>
  vocab.all.flatMap((comp) =>
    vocab.props(comp)
      .map((prop) => vocab.prop(comp, prop)!)
      .filter(pick)
      .map((c) => ({ comp, prop: c.prop }))
  )

// How a stored property is turned into the text to index, keyed `comp.prop`:
// given a SQL expression for the stored value, the entry returns a SQL
// expression for the text that value stands for. A property with no entry
// is indexed as stored, which covers every ordinary text property.
//
// It exists because a stored value is not always its own text: @yaks/blob
// stores a body's SHA-256 and keeps the prose in a separate table, so a trigger
// reading the column would index the hash. `blobText(vocab)` returns a map of
// this shape; the type is declared structurally here so that accepting one adds
// no dependency.
export type Text = Record<string, (stored: string) => string>

// One component's search index: the component it mirrors and the properties
// it covers, in the order they are declared to FTS5.
export type Index = { comp: string; props: string[] }

// The fields grouped into indexes, one per component, in first-seen order.
export let indexes = (fields: Field[]): Index[] => {
  let by = new Map<string, string[]>()
  for (let f of fields) by.set(f.comp, [...(by.get(f.comp) ?? []), f.prop])
  return [...by].map(([comp, props]) => ({ comp, props }))
}

// The name of the index mirroring a component: `book` → `book_fts`.
export let indexName = (comp: string): string => `${comp}_fts`

// The name of the view that presents a component's columns as text: `doc` →
// `doc_text`. It is created only for a component where at least one indexed
// column has to be resolved (see {@link Text}); an index whose columns hold
// their own text mirrors the component table itself.
export let textName = (comp: string): string => `${comp}_text`
