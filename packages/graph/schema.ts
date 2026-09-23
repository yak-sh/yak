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
  release: 'this component is removed and the entity stays',
  keep: 'the reference stays as history',
}

// A value of the right shape for an example: the property's own first example
// where it declares one, otherwise something its type and format would hold,
// and `…` for text that nothing says more about. Never a value anybody should
// keep.
let sample = (s: PropSchema): unknown => {
  if (s.examples?.length) return s.examples[0]
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
    ? '2026-09-23T12:00:00Z'
    : s.format == 'date'
    ? '2026-09-23'
    : s.format == 'uri'
    ? 'https://example.com'
    : s.format == 'email'
    ? 'ann@example.com'
    : s.format == 'json'
    ? '{}'
    : '…'
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

let listed = (xs: readonly unknown[]): string => xs.map(String).join(', ')

// The vocabulary's descriptions read as sentences here: a capital first letter
// and a full stop, however each was written.
let sentence = (s: string): string => {
  let t = s.trim()
  return t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.')
}

// One JSON value on one line, spaced the way a person writes it.
let inline = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(inline).join(', ')}]`
    : v && typeof v == 'object'
    ? `{${
      Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`)
        .join(', ')
    }}`
    : JSON.stringify(v)

// A property's type in words: its closed set of values, the component it
// references, its format, or its JSON type.
let typed = (s: PropSchema): string =>
  s.enum?.length
    ? `one of ${listed(s.enum)}`
    : s.ref
    ? `reference to ${s.ref}`
    : s.format ?? typesOf(s).join(' or ')

// What is true of a property beyond its type, a word or two each: who writes
// it, whether it is stored, whether its value is unique.
let notes = (vocab: Vocab, comp: string, prop: string, s: PropSchema) => [
  ...(s.stamped ? ['server-owned'] : []),
  ...(s.computed ? ['computed'] : []),
  ...(vocab.indexes(comp).some((i) =>
      i.unique && i.props.length == 1 && i.props[0] == prop
    )
    ? ['unique']
    : []),
  ...(s.store == 'blob' ? ['kept as bytes'] : []),
]

// A property as a list item: its name, type and notes on the first line, and
// beneath it what it means and what deleting what it references does.
let property = (vocab: Vocab, comp: string, prop: string, s: PropSchema) =>
  [
    `- ${[`${prop}: ${typed(s)}`, ...notes(vocab, comp, prop, s)].join(', ')}`,
    ...(s.description ? [sentence(s.description)] : []),
    ...(s.ref && s.death
      ? [`If that ${s.ref} is deleted, ${DEATH[s.death]}.`]
      : []),
  ].join('\n  ')

// One component as the index shows it, under a heading: what it is, then the
// names of its properties.
let block = (vocab: Vocab, name: string, heading: string): string => {
  let def = vocab.def(name)!
  let props = Object.keys(def.properties ?? {})
  return [
    `${heading} ${name}${def.kind ? ' (kind)' : ''}`,
    def.description && sentence(def.description),
    props.length && listed(props),
  ].filter(Boolean).join('\n\n')
}

// The index body: a heading for each package that declares components, in
// name order, and the components under it. A vocabulary loaded without
// packages has no such level, and its components sit one heading higher.
let grouped = (vocab: Vocab): string => {
  let from = (n: string) => vocab.comp(n)?.package
  if (!vocab.all.some(from)) {
    return vocab.all.map((n) => block(vocab, n, '##')).join('\n\n')
  }
  let packages = [...new Set(vocab.all.map(from))]
    .sort((a, b) => a == null ? 1 : b == null ? -1 : a < b ? -1 : 1)
  return packages.map((p) =>
    [
      `## ${p ?? 'no package'}`,
      ...vocab.all.filter((n) => from(n) == p).map((n) =>
        block(vocab, n, '###')
      ),
    ].join('\n\n')
  ).join('\n\n')
}

// One component in full, as a page.
let page = (vocab: Vocab, name: string, guide?: Guide): string => {
  let def = vocab.def(name)!
  let info = vocab.comp(name)!
  let before = info.before.filter((n) => vocab.comp(n))
  let id = vocab.identity(name)
  let props = Object.entries(def.properties ?? {})
  let into = vocab.refProps()
    .filter(([c, p]) => vocab.prop(c, p)?.ref == name)
    .map(([c, p]) => `- ${c}.${p}`)
  let url = guide?.(name)
  let bundle = {
    entity: { eid: '$1' },
    [name]: def.examples?.[0] ?? example(vocab, name),
  }
  return [
    `# ${name}`,
    [
      def.description && sentence(def.description),
      info.kind &&
      `A kind: an entity with it is shown as a ${name}` +
        (before.length ? `, even beside ${listed(before)}.` : '.'),
      id.length &&
      `Identified by ${listed(id)}: the same values always name the same ` +
        'entity.',
      info.package && `Declared by ${info.package}.`,
    ].filter(Boolean).join('\n'),
    props.length &&
    '## Properties\n\n' +
      props.map(([p, s]) => property(vocab, name, p, s)).join('\n'),
    into.length && '## Referenced by\n\n' + into.join('\n'),
    '## Example\n\n    ' + inline(bundle),
    url && `Documentation: ${url}`,
  ].filter(Boolean).join('\n\n')
}

/** The same answer as {@link schemaOf}, as markdown for a person to read
 * unrendered: headings for structure and nothing bold. The index is a heading
 * for each package and one for each component it declares; a component asked
 * for is a page of its own, its properties nested beneath it; and a kind is
 * its page beside the components it is displayed with. */
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
        ? ['## Shown with', ...shown.map((n) => block(vocab, n, '###'))]
        : []),
    ].join('\n\n')
  }
  if (about.comps?.length) {
    return about.comps.map((n) => page(vocab, n, guide)).join('\n\n')
  }
  return [
    '# Components',
    [
      vocab.kinds.length &&
      `An entity is shown as the first kind it carries: ${
        listed(vocab.kinds)
      }.`,
      'Name a component for its properties in full, or a kind for what it is ' +
      'shown with.',
    ].filter(Boolean).join('\n'),
    grouped(vocab),
  ].join('\n\n')
}
