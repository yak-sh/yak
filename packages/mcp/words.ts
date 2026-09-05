// The vocabulary, said in words. `graph_schema` answers out of here: the
// INDEX, when nobody named anything — every component, its one line, its
// column names — and one component IN FULL when somebody did: what each column
// is, what the vocabulary says it means, what is server-owned or unique or
// kept as bytes, what points at it and what it points at, and a bundle that
// writes it.
//
// Jeff, 2026-09-05: "can we otherwise add some vocab tools? for getting
// specific parts and also the full thing probably? should come with docs, i
// expect, to explain the meaning". So the answer is not the loaded documents
// handed over whole — that is a wall of JSON Schema an agent pays for in full
// to learn one word. It is the index, small enough to read, and then the word
// asked for.
//
// Everything here is DERIVED: nothing is written down twice. A description is
// the one the vocab.json carries, and a column with none is answered without
// one rather than with a sentence somebody invented here.

import { z } from 'zod'
import type { Column, Vocab } from '@yaks/vocab'

/** Where a component is documented at length, when its host has such a page —
 * `mail` → the guide's mail page. The vocabulary knows nothing about a guide,
 * so the host that has one says so. */
export type Guide = (comp: string) => string | undefined

// What death means for the entity holding the reference, said the way the
// person reading it would ask: what happens to my row when that one dies.
let DEATH: Record<string, string> = {
  cascade: 'this entity dies with it',
  detach: 'this column is cleared',
  release: 'this row dies, the entity lives',
  keep: 'the reference stands as history',
}

// A column's type in one word, and its closed set or target beside it.
let typeOf = (col: Column): string =>
  col.category == 'enum' ? 'enum' : col.category == 'ref' ? 'ref' : col.scalar!

// What is true of a column beyond its type: who may write it, whether it is
// stored at all, what it promises, and what its death means.
let notesOf = (vocab: Vocab, col: Column): string[] => {
  let notes: string[] = []
  if (col.stamped) notes.push('server-owned: readable, never written here')
  if (!col.persist) notes.push('computed: read, never stored')
  if (
    vocab.indexes(col.comp).some((i) =>
      i.unique && i.cols.length == 1 && i.cols[0] == col.prop
    )
  ) notes.push('unique: no two rows share this value')
  if (col.keywords.store == 'blob') {
    notes.push('kept as content-addressed bytes, read back as its text')
  }
  if (col.category == 'ref' && col.death) {
    notes.push(`when the entity it names dies, ${DEATH[col.death]}`)
  }
  return notes
}

// A value of the right shape, for the example bundle: enough for a reader to
// see what goes there, never a value anybody should keep.
let sample = (col: Column): unknown =>
  col.category == 'enum'
    ? col.values?.[0]
    : col.category == 'ref'
    ? '$other'
    : col.scalar == 'bool'
    ? true
    : col.scalar == 'number' || col.scalar == 'priority'
    ? 1
    : col.scalar == 'time'
    ? '2026-09-05T12:00:00Z'
    : col.scalar == 'url'
    ? 'https://example.com'
    : 'text'

/** One component as the index says it: the line an agent reads to decide
 * whether to ask for the whole of it. */
export let summary = (vocab: Vocab, name: string) => {
  let info = vocab.comp(name)!
  return {
    name,
    ...(info.description ? { description: info.description } : {}),
    kind: info.kind,
    columns: vocab.columns(name),
  }
}

/** One component in full: every column with its type, its meaning and what is
 * true of it, the references either way, a bundle that writes it, and the page
 * that covers it where the host has one. */
export let detail = (vocab: Vocab, name: string, guide?: Guide) => {
  let info = vocab.comp(name)!
  let cols = vocab.columns(name).map((prop) => vocab.column(name, prop)!)
  let out = cols.filter((c) => c.category == 'ref')
  let into = vocab.refCols()
    .map(([comp, prop]) => vocab.column(comp, prop)!)
    .filter((c) => c.ref == name)
  let page = guide?.(name)
  return {
    ...summary(vocab, name),
    columns: cols.map((col) => ({
      prop: col.prop,
      type: typeOf(col),
      ...(col.description ? { description: col.description } : {}),
      ...(col.values ? { values: col.values } : {}),
      ...(col.ref ? { ref: col.ref } : {}),
      ...(notesOf(vocab, col).length ? { notes: notesOf(vocab, col) } : {}),
    })),
    // A kind sorts BEFORE the words it is usually worn with: an entity wearing
    // `mail` and `doc` reads as mail, which is the same thing as saying a
    // letter is a mail wearing a doc.
    ...(info.kind && info.before.length ? { worn_with: info.before } : {}),
    references: {
      out: out.map((c) => ({ prop: c.prop, to: c.ref! })),
      in: into.map((c) => ({ comp: c.comp, prop: c.prop })),
    },
    example: {
      entity: { eid: '$1' },
      [name]: Object.fromEntries(
        info.writable.map((prop) => [prop, sample(vocab.column(name, prop)!)]),
      ),
    },
    ...(page ? { guide: page } : {}),
  }
}

/** The index: every component, one line each, and the display kinds in the
 * order the vocabulary sorts them. */
export let index = (vocab: Vocab) => ({
  comps: vocab.all.map((name) => summary(vocab, name)),
  kinds: vocab.kinds,
})

/** What an entity of one KIND is made of: the component that names it, whole,
 * and a line each for the words it is worn with — a letter is a `mail` wearing
 * a `doc`, which is the same fact as `mail` sorting before `doc`. */
export let ofKind = (vocab: Vocab, kind: string, guide?: Guide) => ({
  kind,
  comps: [
    detail(vocab, kind, guide),
    ...(vocab.comp(kind)?.before ?? [])
      .filter((n) => vocab.comp(n))
      .map((n) => summary(vocab, n)),
  ],
})

/**
 * What `graph_schema` promises: components — a line each in the index, all of
 * it when one was asked for — plus the kind list, or the kind asked about.
 */
export let schemaSchema: z.ZodTypeAny = z.object({
  comps: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
      kind: z.boolean().describe('whether this component names a display kind'),
      columns: z.union([
        z.array(z.string()),
        z.array(
          z.object({
            prop: z.string(),
            type: z.string(),
            description: z.string().optional(),
            values: z.array(z.string()).optional(),
            ref: z.string().optional(),
            notes: z.array(z.string()).optional(),
          }).passthrough(),
        ),
      ]),
      worn_with: z.array(z.string()).optional(),
      references: z.object({
        out: z.array(z.object({ prop: z.string(), to: z.string() })),
        in: z.array(z.object({ comp: z.string(), prop: z.string() })),
      }).optional(),
      example: z.record(z.unknown()).optional(),
      guide: z.string().optional(),
    }).passthrough(),
  ),
  kinds: z.array(z.string()).optional(),
  kind: z.string().optional(),
})
