// The vocabulary, described as plain data. `graph_schema` returns what this
// file builds: the index when the call named no component — every component,
// its one-line description, its property names — and one component in full when
// it named one: what each property is, the description the vocabulary gives it,
// which properties are server-owned or unique or stored as bytes, what
// references it and what it references, and an example bundle that writes it.
//
// Jeff, 2026-09-05: "can we otherwise add some vocab tools? for getting
// specific parts and also the full thing probably? should come with docs, i
// expect, to explain the meaning". So the result is not the loaded schema
// documents handed over whole — that is a wall of JSON Schema an agent pays
// for in full to learn one component. It is the index, small enough to read,
// and then the component asked for.
//
// Everything here is derived: nothing is written down twice. A description is
// the one the vocab.json carries, and a property that has none is returned
// without one rather than with a sentence invented here.

import type { Prop, Vocab } from '@yaks/vocab'

/** Where a component is documented at length, when the program that opened
 * the graph has such a page — `mail` → the guide's mail page. The vocabulary
 * knows nothing about a guide, so that program supplies this function. */
export type Guide = (comp: string) => string | undefined

/** One property, described: its type in one word, whatever description the
 * vocabulary gives it, its allowed values or the component it references, and
 * what else is true of it. */
export type Term = {
  prop: string
  type: string
  description?: string
  values?: string[]
  ref?: string
  notes?: string[]
}

/** One component, described. The index fills in the first three fields;
 * asking for the component fills the rest in and describes each property. */
export type Word = {
  name: string
  description?: string
  kind: boolean
  props: string[] | Term[]
  worn_with?: string[]
  references?: {
    out: { prop: string; to: string }[]
    in: { comp: string; prop: string }[]
  }
  example?: Record<string, unknown>
  guide?: string
}

/** What `graph_schema` returns, in any of its three sizes. */
export type Said = { comps: Word[]; kinds?: string[]; kind?: string }

// What deleting the referenced entity means for the entity holding the
// reference, phrased the way the reader would ask it: what happens to my row
// when that one is deleted.
let DEATH: Record<string, string> = {
  cascade: 'this entity dies with it',
  detach: 'this property is cleared',
  release: 'this row dies, the entity lives',
  keep: 'the reference stands as history',
}

// A property's type in one word: `enum` for a closed set of values, `ref` for a
// reference, the JSON types a JSON value may be (`object`, `string|array`),
// otherwise the scalar type the vocabulary declares.
let typeOf = (prop: Prop): string =>
  prop.category == 'enum'
    ? 'enum'
    : prop.category == 'ref'
    ? 'ref'
    : prop.scalar == 'jsonb'
    ? prop.types!.join('|')
    : prop.scalar!

// What is true of a property beyond its type: who may write it, whether it is
// stored at all, whether its value must be unique, and what deleting the
// entity it references does to this row.
let notesOf = (vocab: Vocab, prop: Prop): string[] => {
  let notes: string[] = []
  if (prop.stamped) notes.push('server-owned: readable, never written here')
  if (prop.computed) notes.push('computed: read, never stored')
  if (
    vocab.indexes(prop.comp).some((i) =>
      i.unique && i.props.length == 1 && i.props[0] == prop.prop
    )
  ) notes.push('unique: no two rows share this value')
  if (prop.keywords.store == 'blob') {
    notes.push('kept as content-addressed bytes, read back as its text')
  }
  if (prop.category == 'ref' && prop.death) {
    notes.push(`when the entity it names dies, ${DEATH[prop.death]}`)
  }
  return notes
}

// A value of the right shape, for the example bundle: enough for a reader to
// see what goes there, never a value anybody should keep.
let sample = (prop: Prop): unknown =>
  prop.category == 'enum'
    ? prop.values?.[0]
    : prop.category == 'ref'
    ? '$other'
    : prop.scalar == 'bool'
    ? true
    : prop.scalar == 'number' || prop.scalar == 'priority'
    ? 1
    : prop.scalar == 'time'
    ? '2026-09-05T12:00:00Z'
    : prop.scalar == 'url'
    ? 'https://example.com'
    : prop.scalar == 'json'
    ? '{}'
    : prop.scalar == 'jsonb'
    ? (prop.types!.includes('object')
      ? {}
      : prop.types!.includes('array')
      ? []
      : 'text')
    : 'text'

/** One component as the index lists it: the one-line summary an agent reads
 * to decide whether to ask for the whole of it. */
export let summary = (vocab: Vocab, name: string): Word => {
  let info = vocab.comp(name)!
  return {
    name,
    ...(info.description ? { description: info.description } : {}),
    kind: info.kind,
    props: vocab.props(name),
  }
}

/** One component in full: every property with its type, its description and
 * what is true of it, the references in both directions, an example bundle
 * that writes it, and the documentation page covering it where the program
 * that opened the graph supplies one. */
export let detail = (vocab: Vocab, name: string, guide?: Guide): Word => {
  let info = vocab.comp(name)!
  let props = vocab.props(name).map((prop) => vocab.prop(name, prop)!)
  let out = props.filter((c) => c.category == 'ref')
  let into = vocab.refProps()
    .map(([comp, prop]) => vocab.prop(comp, prop)!)
    .filter((c) => c.ref == name)
  let page = guide?.(name)
  return {
    ...summary(vocab, name),
    props: props.map((prop) => ({
      prop: prop.prop,
      type: typeOf(prop),
      ...(prop.description ? { description: prop.description } : {}),
      ...(prop.values ? { values: prop.values } : {}),
      ...(prop.ref ? { ref: prop.ref } : {}),
      ...(notesOf(vocab, prop).length ? { notes: notesOf(vocab, prop) } : {}),
    })),
    // A kind sorts before the components it is usually stored with: an entity
    // carrying both `mail` and `doc` displays as mail, which is the same fact
    // as saying a letter is a `mail` that also has a `doc`.
    ...(info.kind && info.before.length ? { worn_with: info.before } : {}),
    references: {
      out: out.map((c) => ({ prop: c.prop, to: c.ref! })),
      in: into.map((c) => ({ comp: c.comp, prop: c.prop })),
    },
    example: {
      entity: { eid: '$1' },
      [name]: Object.fromEntries(
        info.writable.map((prop) => [prop, sample(vocab.prop(name, prop)!)]),
      ),
    },
    ...(page ? { guide: page } : {}),
  }
}

/** The index: every component, one line each, and the display kinds in the
 * order the vocabulary sorts them. */
export let index = (vocab: Vocab): Said => ({
  comps: vocab.all.map((name) => summary(vocab, name)),
  kinds: vocab.kinds,
})

/** What an entity of one kind is made of: the component that names the kind,
 * in full, and a line each for the components it is usually stored with — a
 * letter is a `mail` that also has a `doc`, which is the same fact as `mail`
 * sorting before `doc`. */
export let ofKind = (vocab: Vocab, kind: string, guide?: Guide): Said => ({
  kind,
  comps: [
    detail(vocab, kind, guide),
    ...(vocab.comp(kind)?.before ?? [])
      .filter((n) => vocab.comp(n))
      .map((n) => summary(vocab, n)),
  ],
})
