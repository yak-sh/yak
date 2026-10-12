// A reader over a file no writer has brought to its vocabulary yet. A writer
// adds what a vocabulary needs the first time it opens the file; a reader
// never changes the schema, so until then a component's table may not exist.
// A query about that component answers what it would the moment a writer
// created the table and before anyone wrote a row: nothing. This file is the
// dialect that says so: each absent component reads as an empty relation of
// the columns its table will have, spliced in where the binder names the
// table. A temporary table cannot stand in: it would shadow the real one once
// a writer creates it, and a Durable Object's SQLite refuses temp objects.

import type { Vocab } from '@yaks/vocab'
import { as, lit, select, sub } from './ast.ts'
import { inline, q } from './render.ts'
import { type Dialect, field } from './sqlite.ts'

// No row, with the owner column and every stored property's column.
let empties = new WeakMap<Vocab, Map<string, string>>()
let empty = (v: Vocab, comp: string): string => {
  let held = empties.get(v) ?? new Map<string, string>()
  empties.set(v, held)
  let got = held.get(comp)
  if (got == null) {
    held.set(
      comp,
      got = inline(sub(select({
        cols: [
          as(lit(null), 'entity'),
          ...v.props(comp).map((p) => v.prop(comp, p)!)
            .filter((c) => !c.computed)
            .map((c) => as(lit(null), field(c.prop))),
        ],
        where: lit(0),
      }))),
    )
  }
  return got
}

/** The dialect `d`, with each component in `absent` read as an empty
 * relation of its table's columns. */
export let absentDialect = (
  d: Dialect,
  v: Vocab,
  absent?: readonly string[],
): Dialect => {
  if (!absent?.length) return d
  let gone = new Set(absent)
  let named = (comp: string) => `${empty(v, comp)} as ${q(comp)}`
  let { indexed, joined, owned } = d
  return {
    ...d,
    table: (comp) => gone.has(comp) ? named(comp) : d.table(comp),
    source: (comp) =>
      gone.has(comp) ? empty(v, comp) : d.source?.(comp) ?? q(comp),
    ...joined && {
      joined: (comp) => gone.has(comp) ? named(comp) : joined(comp),
    },
    ...indexed && {
      indexed: (comp, index) =>
        gone.has(comp) ? named(comp) : indexed(comp, index),
    },
    ...owned && {
      owned: (comp) => gone.has(comp) ? named(comp) : owned(comp),
    },
  }
}
