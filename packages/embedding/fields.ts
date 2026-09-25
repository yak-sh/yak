// Which text is embedded. Semantic search here is not tied to one "document"
// component: a vocabulary declares components, some of their properties hold
// prose, and a vector can be made from any of them. This module is that choice
// — a `Field` is one `comp.prop` pair, `fields()` reads them off a vocabulary,
// and a `Pick` narrows that default when an application wants only some of
// them.
//
// The difference from a search index: an entity gets one vector, not one per
// component. A vector is a point in a space of meanings, and an entity is one
// thing — so all of its text fields are read and joined into a single string,
// in vocabulary order, before being embedded. That is also why this rule lives
// here rather than in a package shared with the full-text one: the two read the
// vocabulary the same way and then do different things with it, and neither
// should have to depend on the other in order to search.

import { col, eq, join, type Query, select, table, union } from '@yaks/sql'
import type { Prop, Vocab } from '@yaks/vocab'

/** A `comp.prop` pair naming one embedded text property; for text an entity
 * is found by through another of its components, that component (`on`: an
 * `entry` is found by `content.body`); and — for a property that does not hold
 * its own text, like a @yaks/blob body holding an address — the SQL that reads
 * the text a stored value stands for. */
export type Field = {
  comp: string
  prop: string
  on?: string
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
 * Decides whether a property is embedded. An application passes its own to
 * embed less than everything textual — say, the blurb but not the title.
 */
export type Pick = (prop: Prop) => boolean

/**
 * The default choice: every stored text property. A computed property has no
 * row to read, and a number, a stamp or a reference is not prose.
 */
export let textual: Pick = (c) =>
  !c.computed && c.category == 'scalar' && c.scalar == 'text'

/**
 * The text a bare word searches: the stored text properties the vocabulary
 * marks `search: true`. What a plugin embeds when its config names no `text`,
 * beside the text a component's `search` list says its entities are found by
 * (a transcript entry's `content.body`), so a vector is made of what people
 * and agents said, never of tool arguments or command lines, which are text
 * too.
 */
export let searched: Pick = (c) => textual(c) && c.search

/** The embedded fields of a vocabulary, by component then declaration order,
 * then the text each component's `search` list names — the same text a bare
 * word finds (@yaks/fts), so what is found by its words is found by its
 * meaning too. `pick` narrows the properties; a list is the vocabulary's own
 * statement about its component and is always taken. */
export let fields = (vocab: Vocab, pick: Pick = textual): Field[] => [
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
 * when it has something to embed. `owners` narrows it to those entities, which
 * is how the sweep reads only what it owes. Returns null for a vocabulary with
 * no text properties at all: there is no statement to write.
 *
 * Text, not an @yaks/sql node, because a field's `text` is a derived read
 * (@yaks/sql `DerivedProp.text`), which is SQL text.
 */
export let pieces = (fields: Field[], owners?: number[]): Stmt | null =>
  fields.length
    ? {
      sql: fields.map((f, i) => {
        let stored = `"c".${q(f.prop)}`
        let col = f.text ? f.text(stored) : stored
        return `select "c"."entity" as owner, ${i} as ord,` +
          ` ${col} as t from ${q(f.comp)} "c"` +
          (f.on ? ` join ${q(f.on)} "o" on "o"."entity" = "c"."entity"` : '') +
          ` where trim(coalesce(${col}, ''), ?) != ''` +
          (owners
            ? ` and "c"."entity" in (select value from json_each(?))`
            : '')
      }).join(' union all '),
      params: fields.flatMap(() =>
        owners ? [WS, JSON.stringify(owners)] : [WS]
      ),
    }
    : null

/**
 * Every entity that wears an embedded field, text or no text: what is owed a
 * look when the fields themselves change. It reads no text, so it costs an
 * index scan per field rather than the corpus.
 */
export let wearers = (fields: Field[]): Query | null =>
  fields.length
    ? union(...fields.map((f) =>
      select({
        cols: [col('entity', 'c')],
        from: table(f.comp, 'c'),
        joins: f.on
          ? [join(table(f.on, 'o'), eq(col('entity', 'o'), col('entity', 'c')))]
          : [],
      })
    ))
    : null
