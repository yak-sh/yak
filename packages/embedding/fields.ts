// Which text is embedded. Semantic search here is not tied to one "document"
// component: a vocabulary declares components, some of their columns hold prose,
// and a vector can be made from any of them. This module is that choice — a
// `Field` is one `comp.prop` pair, `fields()` reads them off a vocabulary, and
// a `Pick` narrows that default when an application wants only some of them.
//
// The difference from a search index: an entity gets one vector, not one per
// component. A vector is a point in a space of meanings, and an entity is one
// thing — so all of its text fields are read and joined into a single string,
// in vocabulary order, before being embedded. That is also why this rule lives
// here rather than in a package shared with the full-text one: the two read the
// vocabulary the same way and then do different things with it, and neither
// should have to depend on the other in order to search.

import type { Column, Vocab } from '@yaks/vocab'

/** A `comp.prop` pair naming one embedded text property, and — for a column
 * that does not hold its own text, like a @yaks/blob body holding an address —
 * the SQL that reads the text a stored value stands for. */
export type Field = {
  comp: string
  prop: string
  text?: (stored: string) => string
}

/** Fields read through a host's derived columns (@yaks/sql `Derived`), so a
 * content-addressed body is embedded as its prose, never as its hash. */
export let resolved = (
  fields: Field[],
  derived: Record<string, { text?: (stored: string) => string }> = {},
): Field[] =>
  fields.map((f) => {
    let text = derived[`${f.comp}.${f.prop}`]?.text
    return text ? { ...f, text } : f
  })

/**
 * Decides whether a column is embedded. An application passes its own to embed
 * less than everything textual — say, the blurb but not the title.
 */
export type Pick = (column: Column) => boolean

/**
 * The default choice: every stored text column. A computed column has no row to
 * read, and a number, a stamp or a reference is not prose.
 */
export let textual: Pick = (c) =>
  !c.computed && c.category == 'scalar' && c.scalar == 'text'

/** The embedded fields of a vocabulary, by component then declaration order. */
export let fields = (vocab: Vocab, pick: Pick = textual): Field[] =>
  vocab.all.flatMap((comp) =>
    vocab.columns(comp)
      .map((prop) => vocab.column(comp, prop)!)
      .filter(pick)
      .map((c) => ({ comp, prop: c.prop }))
  )

// SQLite's trim() strips spaces only, so the whitespace that makes a text
// "empty" has to be listed. One rule, written once: a field's text counts when
// it holds something other than these characters.
let WS = ' \t\n\r\v\f'

/** A statement and the params it binds, in order. */
export type Stmt = { sql: string; params: (string | number)[] }

/** An identifier, quoted for SQL. */
export let q = (name: string): string => `"${name.replaceAll('"', '""')}"`

/**
 * Every embeddable piece of text in the graph, as one row per (entity, field):
 * the owner's integer id, the field's position in the join order, and the text.
 * Blank fields are dropped here, so an entity appears in this result exactly
 * when it has something to embed — which makes this the one statement both the
 * sweep and the prune read, so the two cannot disagree. Returns null for a
 * vocabulary with no text columns at all: there is no statement to write.
 */
export let pieces = (fields: Field[]): Stmt | null =>
  fields.length
    ? {
      sql: fields.map((f, i) => {
        let stored = `${q(f.comp)}.${q(f.prop)}`
        let col = f.text ? f.text(stored) : stored
        return `select ${q(f.comp)}."entity" as owner, ${i} as ord,` +
          ` ${col} as t from ${q(f.comp)}` +
          ` where trim(coalesce(${col}, ''), ?) != ''`
      }).join(' union all '),
      params: fields.map(() => WS),
    }
    : null
