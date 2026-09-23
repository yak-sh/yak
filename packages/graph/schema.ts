// The vocabulary described, which is what `graph_schema` answers (./tools.ts):
// one JSON Schema document for a program, and the same facts as markdown for a
// person. The document has the shape of a vocab.json, every component's
// declared entry under one `$defs`, so an answer is read, validated and loaded
// the way any vocabulary document is.
//
// Three sizes, one per question. The index is every component with its
// description, whether it names a kind, and each property's type, small enough
// to read whole. A component asked for by name is its entry as declared, with
// an example value. A kind is that component whole, beside the index entries
// of the components it is displayed with.
//
// Everything is derived: a description is the one the vocabulary carries, and
// a property that has none is described without one.

import { type PropSchema, typesOf, type Vocab } from '@yaks/vocab'

/** Where a component is documented at length, when the program that opened
 * the graph has such a page — `mail` → the guide's mail page. The vocabulary
 * knows nothing about a guide, so that program supplies this function. */
export type Guide = (comp: string) => string | undefined

/** What is being asked about: nothing for the index, components by name, or a
 * kind. */
export type About = { comps?: string[]; kind?: string }

/** A vocabulary document: the components under one `$defs`. */
export type SchemaDoc = {
  $vocabulary?: Record<string, boolean>
  $defs: Record<string, PropSchema>
}

// What deleting the referenced entity does to the entity holding the
// reference, phrased the way its reader asks: what happens to mine when that
// one is deleted.
let DEATH: Record<string, string> = {
  cascade: 'this entity is deleted with it',
  detach: 'this property is cleared',
  release: 'this component is removed and the entity lives',
  keep: 'the reference stands as history',
}

// A value of the right shape for an example: enough to see what goes there,
// never a value anybody should keep.
let sample = (s: PropSchema): unknown => {
  if (s.enum?.length) return s.enum[0]
  if (s.ref) return '$other'
  let t = typesOf(s)[0]
  return t == 'boolean'
    ? true
    : t == 'number' || t == 'integer'
    ? 1
    : t == 'object'
    ? {}
    : t == 'array'
    ? []
    : s.format == 'date-time'
    ? '2026-09-05T12:00:00Z'
    : s.format == 'uri'
    ? 'https://example.com'
    : s.format == 'json'
    ? '{}'
    : 'text'
}

// A component's example value: every property a client writes, filled in.
let example = (vocab: Vocab, name: string): Record<string, unknown> => {
  let props = vocab.def(name)?.properties ?? {}
  return Object.fromEntries(
    vocab.comp(name)!.writable.map((p) => [p, sample(props[p])]),
  )
}

// A component as the index lists it: what it is, whether it names a kind, and
// each property's type.
let cut = (vocab: Vocab, name: string): PropSchema => {
  let def = vocab.def(name)!
  return {
    component: true,
    type: 'object',
    ...(def.description ? { description: def.description } : {}),
    ...(def.kind ? { kind: true } : {}),
    properties: Object.fromEntries(
      Object.entries(def.properties ?? {}).map((
        [p, s],
      ) => [p, { type: s.type }]),
    ),
  }
}

// A component whole: its entry as declared, with an example value where it
// declares none of its own.
let whole = (vocab: Vocab, name: string): PropSchema => {
  let def = vocab.def(name)!
  return { ...def, examples: def.examples ?? [example(vocab, name)] }
}

// The components an answer is about, each at the size it is asked for.
let entries = (vocab: Vocab, about: About): [string, PropSchema][] => {
  if (about.kind) {
    let shown = (vocab.comp(about.kind)?.before ?? []).filter((n) =>
      vocab.comp(n)
    )
    return [
      [about.kind, whole(vocab, about.kind)],
      ...shown.map((n): [string, PropSchema] => [n, cut(vocab, n)]),
    ]
  }
  if (about.comps?.length) return about.comps.map((n) => [n, whole(vocab, n)])
  return vocab.all.map((n) => [n, cut(vocab, n)])
}

/** The vocabulary, or the part of it asked about, as one JSON Schema document:
 * the keyword vocabularies its documents declare, and each component's entry
 * under `$defs`. */
export let schemaOf = (vocab: Vocab, about: About = {}): SchemaDoc => {
  let used = Object.assign(
    {},
    ...vocab.docs.map((d) => d.$vocabulary ?? {}),
  ) as Record<string, boolean>
  return {
    ...(Object.keys(used).length ? { $vocabulary: used } : {}),
    $defs: Object.fromEntries(entries(vocab, about)),
  }
}

let code = (s: unknown): string => '`' + String(s) + '`'
let listed = (xs: readonly unknown[]): string => xs.map(code).join(', ')

// A property's type in words: its closed set of values, the component it
// references, or its JSON type and format.
let typed = (s: PropSchema): string =>
  s.enum?.length
    ? `one of ${listed(s.enum)}`
    : s.ref
    ? `reference to ${code(s.ref)}`
    : typesOf(s).join(' or ') + (s.format ? ` (${s.format})` : '')

// What is true of a property beyond its type: who writes it, whether it is
// stored, whether its value is unique, and what deleting the entity it
// references does to it.
let notes = (vocab: Vocab, comp: string, prop: string, s: PropSchema) => [
  ...(s.stamped ? ['server-owned, never written by a client'] : []),
  ...(s.computed ? ['computed when read, never stored'] : []),
  ...(vocab.indexes(comp).some((i) =>
      i.unique && i.props.length == 1 && i.props[0] == prop
    )
    ? ['unique: no two entities share a value']
    : []),
  ...(s.store == 'blob'
    ? ['kept as content-addressed bytes, read back as its text']
    : []),
  ...(s.ref && s.death
    ? [`when the entity it names is deleted, ${DEATH[s.death]}`]
    : []),
]

let property = (vocab: Vocab, comp: string, prop: string, s: PropSchema) => {
  let said = [s.description, ...notes(vocab, comp, prop, s)].filter(Boolean)
  return `- ${code(prop)} (${typed(s)})` +
    (said.length ? ` — ${said.join('; ')}` : '')
}

// One line of the index: the name, its properties, what it is.
let line = (vocab: Vocab, name: string): string => {
  let def = vocab.def(name)!
  let props = Object.keys(def.properties ?? {})
  return `- **${name}**${def.kind ? ' (kind)' : ''}` +
    (props.length ? `: ${listed(props)}` : '') +
    (def.description ? ` — ${def.description}` : '')
}

// One component in full, as a page.
let page = (vocab: Vocab, name: string, guide?: Guide): string => {
  let def = vocab.def(name)!
  let info = vocab.comp(name)!
  let before = info.before.filter((n) => vocab.comp(n))
  let id = vocab.identity(name)
  let into = vocab.refProps()
    .filter(([c, p]) => vocab.prop(c, p)?.ref == name)
    .map(([c, p]) => `${c}.${p}`)
  let url = guide?.(name)
  return [
    `# ${name}`,
    def.description,
    info.kind &&
    `A kind: an entity carrying it is shown as a ${name}` +
      (before.length ? `, even beside ${listed(before)}.` : '.'),
    id.length &&
    `Identified by ${listed(id)}: the same values always name the same entity.`,
    Object.entries(def.properties ?? {})
      .map(([p, s]) => property(vocab, name, p, s)).join('\n'),
    into.length && `Referenced by ${listed(into)}.`,
    'As a bundle:\n\n```json\n' +
    JSON.stringify(
      {
        entity: { eid: '$1' },
        [name]: def.examples?.[0] ?? example(vocab, name),
      },
      null,
      2,
    ) + '\n```',
    url && `Documentation: ${url}`,
  ].filter(Boolean).join('\n\n')
}

/** The same answer as {@link schemaOf}, as markdown for a person: the index
 * as one line a component, a component asked for as a page, and a kind as its
 * page beside the lines of the components it is displayed with. */
export let proseOf = (
  vocab: Vocab,
  about: About = {},
  guide?: Guide,
): string => {
  if (about.kind) {
    let shown = (vocab.comp(about.kind)?.before ?? []).filter((n) =>
      vocab.comp(n)
    )
    return [
      page(vocab, about.kind, guide),
      ...(shown.length
        ? [`## Shown with\n\n${shown.map((n) => line(vocab, n)).join('\n')}`]
        : []),
    ].join('\n\n')
  }
  if (about.comps?.length) {
    return about.comps.map((n) => page(vocab, n, guide)).join('\n\n')
  }
  return [
    '# Components',
    vocab.all.map((n) => line(vocab, n)).join('\n'),
    vocab.kinds.length &&
    `An entity is shown as the first kind it carries: ${listed(vocab.kinds)}.`,
    'Name a component for its properties in full, or a kind for what it is ' +
    'shown with.',
  ].filter(Boolean).join('\n\n')
}
