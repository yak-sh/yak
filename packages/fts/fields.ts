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
//
// A component the vocabulary marks `found: false` (a quarantine) keeps its
// wearers out of every word search: their text stays indexed, so the mark
// coming off finds them again at once, and each field carries those components
// as its `not`, which a match tests its owner against.
//
// A property can also keep a substring index (`contains: true`): an FTS5
// trigram index over its text, which a `~=` test reads instead of every value
// (`grams()`). Its fields are marked `trigram`, and group into indexes of their
// own beside the word indexes.

import type { Prop, Vocab } from '@yaks/vocab'

// A `comp.prop` pair naming one indexed text property — a book's title, a
// review's prose, a shop's own description — and, for text an entity is found
// by through another of its components, that component (`on`).
export type Field = {
  comp: string
  prop: string
  on?: string
  // components whose wearers no word search finds (vocabulary `found: false`)
  not?: string[]
  trigram?: true
}

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
      .map((c) => ({ comp, prop: c.prop, ...unfound(vocab) }))
  ),
  ...vocab.all.flatMap((on) =>
    (vocab.comp(on)?.search ?? []).map((name) => {
      let [comp, prop] = name.split('.')
      return { comp, prop, on, ...unfound(vocab) }
    })
  ),
]

// What keeps an entity out of a word search: the components the vocabulary
// marks `found: false`, as the `not` of a field (none, no key).
export let unfound = (vocab: Vocab): { not?: string[] } => {
  let not = vocab.all.filter((comp) => vocab.comp(comp)?.found === false)
  return not.length ? { not } : {}
}

// `f` excluding only the components that stand: one no table stands for yet
// (@yaks/sqlite makes it on its first write) is worn by nobody.
export let trim = (f: Field, stands: (comp: string) => boolean): Field =>
  !f.not || f.not.every(stands) ? f : { ...f, not: f.not.filter(stands) }

// The properties that keep a substring index, the vocabulary's `contains`,
// by component then declaration order. `pick` narrows them.
export let grams = (vocab: Vocab, pick: Pick = (c) => c.contains): Field[] =>
  vocab.all.flatMap((comp) =>
    vocab.props(comp)
      .map((prop) => vocab.prop(comp, prop)!)
      .filter((c) => prose(c) && pick(c))
      .map((c) => ({ comp, prop: c.prop, trigram: true as const }))
  )

// Every field a vocabulary has indexed: its words and its substrings. What a
// store keeps indexes for and its `search` extension reads.
export let indexed = (vocab: Vocab): Field[] => [
  ...fields(vocab),
  ...grams(vocab),
]

// The fields a bare word searches: all but the substring indexes'.
export let worded = (fields: Field[]): Field[] =>
  fields.filter((f) => !f.trigram)

// One search index: its name (the component its entities are found through —
// `on` where there is one, else the text's own), the component whose table
// holds the text, and the properties it covers, in the order they are declared
// to FTS5.
export type Index = {
  name: string
  comp: string
  props: string[]
  on?: string
  // components whose wearers it never answers a word for (`Field.not`)
  not?: string[]
  trigram?: true
}

// The fields grouped into indexes, one per name, in first-seen order.
export let indexes = (fields: Field[]): Index[] => {
  let by = new Map<string, Index>()
  for (let { comp, prop, on, not, trigram } of fields) {
    let name = on ?? comp
    let key = trigram ? gramName(name) : name
    let ix = by.get(key) ??
      {
        name,
        comp,
        props: [],
        ...on ? { on } : {},
        ...not?.length ? { not } : {},
        ...trigram && { trigram },
      }
    ix.props.push(prop)
    by.set(key, ix)
  }
  return [...by.values()]
}

// The name of an index: `book` → `book_fts`.
export let indexName = (name: string): string => `${name}_fts`

// The name of a substring index: `content` → `content_trigram`.
export let gramName = (name: string): string => `${name}_trigram`

// The FTS5 table an index is: its word index, or its substring index.
export let tableOf = (ix: Index): string =>
  ix.trigram ? gramName(ix.name) : indexName(ix.name)

// The view an index reads its text through, where it needs one (`textName`).
export let viewOf = (ix: Index): string =>
  textName(ix.trigram ? gramName(ix.name) : ix.name)

// The substring index of the texts' tails past what a substring index holds,
// and the table listing the pieces it holds: `content_trigram_tail`,
// `content_trigram_piece`.
export let tailOf = (ix: Index): string => `${gramName(ix.name)}_tail`
export let piecesOf = (ix: Index): string => `${gramName(ix.name)}_piece`

// The name of the view that presents an index's columns as text: `doc` →
// `doc_text`. It is created for an index where at least one column has to be
// resolved (a `text` expression in the store's @yaks/sql `Derived`: @yaks/blob
// keeps a body's address, not its prose), and for every index read on behalf
// of another component, which reads its text through a join; an index whose
// columns hold their own text mirrors the component table itself.
export let textName = (name: string): string => `${name}_text`
