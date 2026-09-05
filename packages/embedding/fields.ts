// WHICH text is embedded. Semantic search here is not welded to one "document"
// component: a vocabulary declares components, some of their columns hold prose,
// and any of them can feed a vector. This module is the choice — a `Field` is
// one `comp.prop` pair, `fields()` reads them off a vocabulary, and a `Pick`
// narrows that default when an application wants only some of them.
//
// The difference from a search index: an entity gets ONE vector, not one per
// component. A vector is a point in meaning-space, and an entity is one thing —
// so every field it wears is read and joined into a single text, in vocabulary
// order, before it is embedded. That is also why this rule lives here and not
// in a shared package with the full-text one: the two make the same CHOICE by
// the same rule and then do different things with it, and neither should have
// to depend on the other to search.

import type { Column, Vocab } from '@yaks/vocab'

/** A `comp.prop` pair naming one embedded text property. */
export type Field = { comp: string; prop: string }

/**
 * Decides whether a column is embedded. An application passes its own to embed
 * less than everything textual — say, the blurb but not the title.
 */
export type Pick = (column: Column) => boolean

/**
 * The default choice: every STORED text-shaped column. A computed column has no
 * row to read, and a number, a stamp or a reference is not prose.
 */
export let textual: Pick = (c) =>
  c.persist && c.category == 'scalar' &&
  (c.scalar == 'text' || c.scalar == 'body')

/** The embedded fields of a vocabulary, by component then declaration order. */
export let fields = (vocab: Vocab, pick: Pick = textual): Field[] =>
  vocab.all.flatMap((comp) =>
    vocab.columns(comp)
      .map((prop) => vocab.column(comp, prop)!)
      .filter(pick)
      .map((c) => ({ comp, prop: c.prop }))
  )

// SQLite's trim() strips spaces alone, so the whitespace that makes a text
// "empty" has to be named. One rule, spelled once: a field's text counts when
// it holds something other than these.
let WS = ' \t\n\r\v\f'

/** A statement and the params it binds, in order. */
export type Stmt = { sql: string; params: (string | number)[] }

/** A name as SQL spells it. */
export let q = (name: string): string => `"${name.replaceAll('"', '""')}"`

/**
 * Every embeddable piece of text in the graph, as one row per (entity, field):
 * the owner's integer id, the field's position in the join order, and the text.
 * Blank fields are dropped here, so an entity appears in this result exactly
 * when it has something to embed — which makes it the ONE rule the sweep and
 * the prune both read, and neither can drift from the other. Answers null for
 * a vocabulary with nothing textual in it: there is no statement to write.
 */
export let pieces = (fields: Field[]): Stmt | null =>
  fields.length
    ? {
      sql: fields.map((f, i) => {
        let col = `${q(f.comp)}.${q(f.prop)}`
        return `select ${q(f.comp)}."entity" as owner, ${i} as ord,` +
          ` ${col} as t from ${q(f.comp)}` +
          ` where trim(coalesce(${col}, ''), ?) != ''`
      }).join(' union all '),
      params: fields.map(() => WS),
    }
    : null
