// Which text is searchable. Search is not limited to a single "document"
// component: a vocabulary declares components, some of their properties hold
// prose, and any of those can be indexed. This module makes that selection — a
// `Field` is one `comp.prop` pair, `fields()` reads them off a vocabulary, and
// a `Pick` narrows the default when an application wants only some of them.
//
// The fields are grouped into one index per component (`indexes()`), because an
// FTS5 external-content index mirrors exactly one table. A field read on behalf
// of another component (`on`) is grouped under that one: `entry` is found by
// `content.body`, so `entry_fts` indexes the body of every entity that is an
// entry, and of no other entity carrying `content`.

import type { Prop, Vocab } from '@yaks/vocab'

// A `comp.prop` pair naming one indexed text property — a book's title, a
// review's prose, a shop's own description — and, for text an entity is found
// by through another of its components, that component (`on`).
export type Field = { comp: string; prop: string; on?: string }

// Decides whether a property is indexed. An application passes its own to index
// less than the vocabulary marked — say, titles only.
export type Pick = (prop: Prop) => boolean

// Stored prose: an index is created from a table, so a computed property has no
// stored value to index, and a number or an entity reference holds no words.
let prose: Pick = (c) =>
  !c.computed && c.category == 'scalar' && c.scalar == 'text'

// The default selection: the properties the vocabulary marked searchable with
// `"search": true` (@yaks/vocab). Deciding which prose is worth finding belongs
// to the vocabulary, not to this package: a repository path and a provider name
// are text nobody goes looking for, and indexing them only adds terms a search
// has to wade through. A vocabulary that marks none has nothing to search.
export let searched: Pick = (c) => c.search && prose(c)

// The searchable fields of a vocabulary, by component then declaration order,
// then the text each component's `search` list says its entities are found by.
// `pick` narrows the properties; a list is the vocabulary's own statement about
// its component and is always taken.
export let fields = (vocab: Vocab, pick: Pick = searched): Field[] => [
  ...vocab.all.flatMap((comp) =>
    vocab.props(comp)
      .map((prop) => vocab.prop(comp, prop)!)
      .filter(pick)
      .map((c) => ({ comp, prop: c.prop }))
  ),
  ...vocab.all.flatMap((on) =>
    (vocab.comp(on)?.search ?? []).map((name) => {
      let [comp, prop] = name.split('.')
      return { comp, prop, on }
    })
  ),
]

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

// One search index: its name (the component its entities are found through —
// `on` where there is one, else the text's own), the component whose table
// holds the text, and the properties it covers, in the order they are declared
// to FTS5.
export type Index = { name: string; comp: string; props: string[]; on?: string }

// The fields grouped into indexes, one per name, in first-seen order.
export let indexes = (fields: Field[]): Index[] => {
  let by = new Map<string, Index>()
  for (let { comp, prop, on } of fields) {
    let name = on ?? comp
    let ix = by.get(name) ?? { name, comp, props: [], ...on ? { on } : {} }
    ix.props.push(prop)
    by.set(name, ix)
  }
  return [...by.values()]
}

// The name of an index: `book` → `book_fts`.
export let indexName = (name: string): string => `${name}_fts`

// The name of the view that presents an index's columns as text: `doc` →
// `doc_text`. It is created for an index where at least one column has to be
// resolved (see {@link Text}), and for every index read on behalf of another
// component, which reads its text through a join; an index whose columns hold
// their own text mirrors the component table itself.
export let textName = (name: string): string => `${name}_text`
