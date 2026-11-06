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
import {
  as,
  type Expr,
  from,
  isRaw,
  lit,
  type Query,
  select,
  sub,
} from './ast.ts'
import type { Derived, DerivedProp } from './derived.ts'
import { inline, q } from './render.ts'
import { type Dialect, field } from './sqlite.ts'

// No row, with the owner column and every stored property's column.
let nothing = (v: Vocab, comp: string): Query =>
  select({
    cols: [
      as(lit(null), 'entity'),
      ...v.props(comp).map((p) => v.prop(comp, p)!)
        .filter((c) => !c.computed)
        .map((c) => as(lit(null), field(c.prop))),
    ],
    where: lit(0),
  })
let empties = new WeakMap<Vocab, Map<string, string>>()
let empty = (v: Vocab, comp: string): string => {
  let held = empties.get(v) ?? new Map<string, string>()
  empties.set(v, held)
  let got = held.get(comp)
  if (got == null) held.set(comp, got = inline(sub(nothing(v, comp))))
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

let rewritten = new WeakMap<Derived, Map<string, Derived>>()

/** The read overrides `derived`, with each component in `absent` read as an
 * empty relation wherever one of their expressions names its table: a
 * property computed from another component's rows reads that component as
 * worn by no entity, as the dialect does (`absentDialect`), rather than
 * naming a table the file does not hold. The same registry comes back for the
 * same `absent`, so what is compiled through it is shared too.
 *
 * ```ts
 * import { absentDerived, col, fn, render, select, sub, table } from '@yaks/sql'
 * import { loadVocab } from '@yaks/vocab'
 * import { equal } from '@yaks/testing'
 *
 * let v = loadVocab({ $defs: {
 *   note: { component: true, properties: { title: { type: 'string' } } },
 * } })
 * let derived = {
 *   'note.loud': {
 *     tag: 'text' as const,
 *     expr: () => sub(select({ cols: [fn('upper', col('title'))], from: table('note') })),
 *   },
 * }
 * let read = absentDerived(v, derived, ['note'])
 * equal(render(read['note.loud'].expr(col('id'))).sql.includes('from "note"'), false)
 * equal(absentDerived(v, derived, ['note']), read)
 * equal(absentDerived(v, derived, []), derived)
 * ```
 */
export let absentDerived = (
  v: Vocab,
  derived: Derived,
  absent?: readonly string[],
): Derived => {
  if (!absent?.length) return derived
  let key = [...absent].sort().join(' ')
  let held = rewritten.get(derived) ?? new Map<string, Derived>()
  rewritten.set(derived, held)
  let got = held.get(key)
  if (got) return got
  let gone = new Set(absent)
  let walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk)
    if (!value || typeof value != 'object' || isRaw(value)) return value
    let o = value as Record<string, unknown>
    if (o.t == 'table' && !o.args && gone.has(o.name as string)) {
      return from(nothing(v, o.name as string), (o.as as string) ?? o.name)
    }
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, walk(x)]))
  }
  let swap = <T extends Expr>(e: T): T => walk(e) as T
  got = Object.fromEntries(
    Object.entries(derived).map(([k, p]): [string, DerivedProp] => [k, {
      ...p,
      expr: (...args: Parameters<DerivedProp['expr']>) => swap(p.expr(...args)),
      ...p.text ? { text: (stored: Expr) => swap(p.text!(stored)) } : {},
    }]),
  )
  held.set(key, got)
  return got
}
