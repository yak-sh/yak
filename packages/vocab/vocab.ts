// The runtime. `loadVocab(docs)` reads one or more JSON Schema vocabulary
// documents into an in-memory `Vocab` and exposes the query and routing API a
// storage binder (@yaks/sql) calls: what a property IS, how a dotted path
// routes to {comp, prop} hops, the derived kindOrder and the kind an entity
// carries, and whether an instance is well-formed. These are the same questions
// a hand-generated set of types answers over one hardcoded vocabulary, answered
// here over a loaded document instead — parameterized, not hardcoded.
//
// This package declares zero components: the components you declare are an
// instance of the format, and a small app is a smaller instance of the same
// format.

import type {
  Assoc,
  CompInfo,
  Composite,
  Death,
  Default,
  Hop,
  Identity,
  Index,
  Ladder,
  Namespace,
  Prop,
  PropSchema,
  Scalar,
  VocabDoc,
} from './types.ts'
import type { Keywords } from './keywords.ts'
import { kept, paced, said, saved, type Sync } from './lifetime.ts'
import { type Kind, kindsIn, orderKinds } from './kinds.ts'
import { appended, ladderOf, statusProp } from './status.ts'
import {
  apart,
  type Declared,
  idOf,
  namespaceOf,
  namespaces,
} from './namespace.ts'
import { Ambiguous, Unknown } from './names.ts'
import { type Named, type Reader, reading } from './reading.ts'

export { Ambiguous, Unknown } from './names.ts'

/**
 * The refusal for a property named alone. A name alone is a component; a
 * property is named with its component, so the message names each component
 * that declares it, with what that component is where `about` says (the head
 * of its description), so a caller choosing among several knows which one it
 * meant. It only teaches: what the query means is unchanged.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { unqualified } from '@yaks/vocab'
 * assertEquals(
 *   unqualified('status', ['session', 'task']),
 *   '.status is a property, not a component — name it .session.status or .task.status',
 * )
 * assertEquals(
 *   unqualified('version', ['app', 'deploy'], (c) =>
 *     ({ app: 'one app in a space: its slug', deploy: 'one release of an app' })[c]),
 *   '.version is a property, not a component — name it .app.version (one app in a space) ' +
 *     'or .deploy.version (one release of an app)',
 * )
 * ```
 */
export let unqualified = (
  prop: string,
  comps: string[],
  about: (comp: string) => string | undefined = () => undefined,
): string => {
  let forms = comps.map((c) => {
    let is = gist(about(c))
    return `.${c}.${prop}${is ? ` (${is})` : ''}`
  })
  let last = forms.pop()
  return `.${prop} is a property, not a component — name it ${
    forms.length ? `${forms.join(', ')} or ` : ''
  }${last}`
}

// What a description says a component is: its first clause, before the
// colon, comma, parenthesis, dash or sentence that goes on to its parts.
let gist = (description?: string) =>
  description?.split(/[:;(,]|\s—\s|\.\s/)[0].trim() || undefined

// The scalar types a `~=` contains-test reads as text.
let TEXT = ['text', 'url', 'query']

/**
 * The refusal for a value compared with a component. A name alone is a
 * component, which an entity wears or not, and only a property holds a value,
 * so `.topic~=moss` names no value to compare: the message gives the forms that
 * do, the text properties for `~=`, beside the bare word that searches all
 * indexed text. `path` is the clause's path, ending at the component
 * (`topic`, or `filed.project.task` past references); `value` is as written.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { loadVocab, valueless } from '@yaks/vocab'
 *
 * let v = loadVocab([{
 *   $defs: {
 *     topic: {
 *       component: true,
 *       type: 'object',
 *       properties: { name: { type: 'string' }, rank: { type: 'number' } },
 *     },
 *   },
 * }])
 * assertEquals(
 *   valueless(v, 'topic', '~=', 'moss'),
 *   '.topic~=moss names a component, not a property: a component is ' +
 *     'present or absent, and its properties hold values — write ' +
 *     '.topic.name~=moss, or the bare word moss to search all indexed text',
 * )
 * assertEquals(
 *   valueless(v, 'topic', '>', '2'),
 *   '.topic>2 names a component, not a property: a component is present or ' +
 *     'absent, and its properties hold values — write .topic.name>2 or ' +
 *     '.topic.rank>2',
 * )
 * ```
 */
export let valueless = (
  v: Vocab,
  path: string,
  op: string,
  value: string,
): string => {
  let comp = path.split('.').at(-1)!
  let said = `.${path}${op}${value} names a component, not a property:`
  let props = v.props(comp)
  if (!props.length) {
    return `${said} ${comp} has no properties, so it is present (.${path}) ` +
      `or absent (!${path})`
  }
  let text = op == '~='
  // The spine's eid is no declared property, and it is what an entity is
  // named by: `.entity=T-12` meant `.entity.eid=T-12`.
  let named = comp == SPINE && (op == '=' || op == '!=') ? [EID] : []
  let forms = [
    ...named,
    ...props.filter((p) => {
      let c = v.prop(comp, p)!
      return text
        ? c.category == 'scalar' && TEXT.includes(c.scalar!)
        : c.scalar != 'jsonb' && c.scalar != 'binary'
    }),
  ].map((p) => `.${path}.${p}${op}${value}`)
  let word = /\s/.test(value) ? `"${value}"` : value
  let search = `the bare word ${word} to search all indexed text`
  let last = forms.pop()
  let fix = last
    ? `write ${forms.length ? `${forms.join(', ')} or ` : ''}${last}${
      text ? `, or ${search}` : ''
    }`
    : text
    ? `${comp} holds no text, so write ${search}`
    : shapeOf(v, comp)
  return `${said} a component is present or absent, and its properties hold ` +
    `values — ${fix}`
}

// The keywords an extension entry may carry. Everything else about a component
// — its kind, its prefix, its indexes, whether it reaches the wire — belongs to
// the document that declares it, so an extension that states one of those is a
// mistake rather than an override. `status` adds rungs to the ladder the
// declaring document gives it (./status.ts).
let ADDABLE = [
  '$id',
  'component',
  'extends',
  'type',
  'description',
  'properties',
  'status',
]

// A component another document declares, with one plugin's properties added.
// The spine is what this exists for: `entity` is declared once, and a plugin
// that stores a value beside every entity (@yaks/id's number) adds its
// property instead of declaring a second `entity`. A property the base already
// has is a collision, not an override.
let extended = (
  name: string,
  base: PropSchema | undefined,
  more: PropSchema,
): PropSchema => {
  if (!base) {
    throw new Error(`'${name}' extends a component no document declares`)
  }
  let stray = Object.keys(more).filter((k) =>
    !ADDABLE.includes(k) && k != 'required'
  )
  if (stray.length) {
    throw new Error(
      `'${name}' extends a component and may only add properties — drop ${
        stray.join(', ')
      }`,
    )
  }
  let properties = { ...base.properties }
  for (let [prop, schema] of Object.entries(more.properties ?? {})) {
    if (prop in properties) {
      throw new Error(`'${name}' already declares a '${prop}' property`)
    }
    properties[prop] = schema
  }
  let need = [...base.required ?? [], ...more.required ?? []]
  let out = { ...base, properties, ...need.length ? { required: need } : {} }
  return more.status ? appended(name, out, more.status) : out
}

// A schema without its `$comment` notes. A note is for whoever edits the
// document; what a reader needs is the word's description, so nothing loaded
// from a document carries one. A property named `$comment` is declared as a
// schema of its own, an object, and stays.
let unnoted = <T>(s: T): T =>
  Array.isArray(s)
    ? s.map(unnoted) as T
    : s && typeof s == 'object'
    ? Object.fromEntries(
      Object.entries(s).filter(([k, v]) =>
        k != '$comment' || typeof v != 'string'
      ).map(([k, v]) => [k, unnoted(v)]),
    ) as T
    : s

// An extension that only adds rungs to a status, where no document here
// declares the component: a graph composed without the package that declares
// it has none of its entities to read a status of, as with `search`.
let rungsOnly = (more: PropSchema): boolean =>
  !!more.status && !Object.keys(more.properties ?? {}).length &&
  !more.required?.length

// A component's `search` list: the text its entities are found by, read off
// another component — `entry` names `content.body`, so a transcript entry is
// found by what it says, while the tool results that also carry `content` are
// not. It is checked once every document is read, because
// the text it names is usually declared by another package, and a name whose
// component this load does not declare is text this graph cannot hold: it is
// left out, the way a graph composed without that package has none of its
// rows. The names share one component (one index reads one table), and each
// is stored prose. A component that searches its own properties has an index
// of that name already, so it cannot also carry a list. Returns the names
// kept.
let found = (
  name: string,
  schema: PropSchema,
  defs: Record<string, PropSchema>,
): string[] => {
  let said = schema.search
  if (said === true) wrong(name, said, 'a component names its text')
  if (said === undefined || said === false) return []
  if (!Array.isArray(said) || !said.length) {
    wrong(name, said, 'a component names its text as ["comp.prop"]')
  }
  let kept = (said as string[]).filter((text) => defs[text.split('.')[0]])
  let owners = new Set<string>()
  for (let text of kept) {
    let [comp, prop, ...rest] = text.split('.')
    let s = defs[comp].properties?.[prop ?? '']
    if (!s || rest.length) wrong(name, said, `${text} is no declared property`)
    if (comp == name) {
      wrong(name, said, 'a component marks its own properties `search`')
    }
    if (
      s!.computed === true || s!.ref != null || s!.enum != null ||
      s!.type != 'string'
    ) wrong(name, said, `${text} is not stored text`)
    owners.add(comp)
  }
  if (owners.size > 1) wrong(name, said, 'the text comes from one component')
  let own = Object.values(schema.properties ?? {}).some((s) => s.search)
  if (own) wrong(name, said, 'its own properties are searched already')
  return kept
}

let wrong = (name: string, said: unknown, why: string): never => {
  throw new Error(`'${name}' searches ${JSON.stringify(said)}: ${why}`)
}

// The extension keywords a registration admits, copied off a schema verbatim.
// A keyword the caller did not register is dropped: the loader carries what
// somebody asked for and nothing else.
let carried = (
  s: PropSchema,
  names: Set<string>,
): Record<string, unknown> => {
  let out: Record<string, unknown> = {}
  for (let n of names) if (s[n] !== undefined) out[n] = s[n]
  return out
}

// The JSON types a property declares: one name, or the members of a union.
export let typesOf = (s: PropSchema): string[] =>
  Array.isArray(s.type) ? [...s.type] : s.type == null ? [] : [s.type]

// A property whose value is a JSON value rather than a scalar: an object, an
// array, or a union of types. It is stored as SQLite's binary JSON.
// A byte value in code. The schema's encoding annotates its JSON form;
// transport doors may also decode other encodings before admission.
export let isBinary = (s: PropSchema): boolean =>
  s.type == 'string' && s.contentEncoding == 'base64'

export let jsonb = (s: PropSchema): boolean =>
  Array.isArray(s.type) || s.type == 'object' || s.type == 'array'

// Every property says what it holds. A property with no `type` is refused
// rather than read as text: the schema is what a reader expects back, and a
// guess is not a promise.
export let TYPES = [
  'string',
  'number',
  'integer',
  'boolean',
  'object',
  'array',
]
let typed = (comp: string, prop: string, s: PropSchema): void => {
  if (typesOf(s).length) return
  throw new Error(
    `${comp}.${prop} declares no type — a property says "type": ` +
      `${TYPES.map((t) => `"${t}"`).join(', ')}, or a union of them`,
  )
}

// One property schema → the property it describes. The scalar type name is
// reconstructed from native JSON Schema (`type` + `format`), so a vocabulary
// authored in plain JSON Schema round-trips to this compact type set.
let scalarOf = (s: PropSchema): Scalar => {
  if (isBinary(s)) return 'binary'
  if (jsonb(s)) return 'jsonb'
  if (s.type == 'boolean') return 'bool'
  if (s.type == 'number' || s.type == 'integer') {
    return s.format == 'priority' ? 'priority' : 'number'
  }
  if (s.format == 'date-time') return 'time'
  if (s.format == 'uri') return 'url'
  if (s.format == 'query') return 'query'
  if (s.format == 'json') return 'json'
  return 'text'
}

// Whether a value is one of the JSON types a property declares. An integer is a
// number too, as JSON Schema reads it.
let holds = (types: string[], v: unknown): boolean => {
  let t = Array.isArray(v)
    ? 'array'
    : v === null
    ? 'null'
    : typeof v == 'number'
    ? (Number.isFinite(v) ? (Number.isInteger(v) ? 'integer' : 'number') : '')
    : typeof v
  return types.includes(t) || (t == 'integer' && types.includes('number'))
}

// A type's name with its article, for a sentence: `an object or an array`.
let a = (t: string) => `${/^[aeiou]/.test(t) ? 'an' : 'a'} ${t}`

let jsonText = (value: unknown): boolean => {
  if (typeof value != 'string') return false
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}

// A number stores as real unless the schema declared `integer`, which is
// native JSON Schema's way of stating the value has no fractional part — so
// the store keeps it as one. A JSON value is SQLite's binary JSON, a blob.
let affinityOf = (
  category: Prop['category'],
  scalar: Scalar | undefined,
  type: PropSchema['type'],
): Prop['affinity'] =>
  scalar == 'jsonb' || scalar == 'binary'
    ? 'blob'
    : category == 'ref' || scalar == 'bool' || type == 'integer'
    ? 'integer'
    : scalar == 'number' || scalar == 'priority'
    ? 'real'
    : 'text'

// Native `default`, read as the two things a row can take: the clock, written
// `{"now": true}`, or a scalar literal. Anything else is no default — the
// storable check is what rejects it.
let defaultOf = (d: unknown): Default | undefined =>
  d != null && typeof d == 'object' && (d as { now?: unknown }).now === true
    ? { now: true }
    : typeof d == 'string' || typeof d == 'number' || typeof d == 'boolean'
    ? { value: d }
    : undefined

// A `death` value, narrowed to the declared type — anything outside the four
// is undefined here and rejected by the storable check.
let deathOf = (s?: string): Death | undefined =>
  s == 'cascade' || s == 'detach' || s == 'release' || s == 'keep'
    ? s
    : undefined

let propOf = (
  comp: string,
  prop: string,
  s: PropSchema,
  extra: Set<string>,
  required: boolean,
): Prop => {
  typed(comp, prop, s)
  let category: Prop['category'] = s.ref != null
    ? 'ref'
    : s.enum != null
    ? 'enum'
    : 'scalar'
  let scalar = category == 'scalar' ? scalarOf(s) : undefined
  let death = deathOf(s.death)
  let id = idOf(s.$id)
  return {
    comp,
    prop,
    ...(id ? { id } : {}),
    description: s.description,
    category,
    scalar,
    values: s.enum ? [...s.enum] : undefined,
    types: scalar == 'jsonb' ? typesOf(s) : undefined,
    aliases: s.aliases,
    ref: s.ref,
    death,
    stamped: !!s.stamped,
    search: s.search === true,
    contains: s.contains === true,
    prose: Array.isArray(s.prose) ? [...s.prose] : s.prose === true,
    computed: s.computed === true,
    ...s.reads ? { reads: [...s.reads] } : {},
    identity: s.identity === true,
    affinity: affinityOf(category, scalar, s.type),
    // A reference carries an FK to entity(id) unless its death is 'keep' — a
    // kept ref outlives its target's tombstone, so it stays FK-free (ddl.ts).
    fk: category == 'ref' && death != 'keep',
    required,
    default: defaultOf(s.default),
    keywords: carried(s, extra),
  }
}

// Documents are immutable once loaded. A component shared by several
// vocabularies has the same compiled metadata in each, unless extension
// keywords change what is carried from its schemas.
type Compiled = {
  read: Map<string, Prop>
  indexes?: Index[]
  identity?: Identity
  paths?: Map<string, Hop[]>
}
let components = new WeakMap<PropSchema, Map<string, Compiled>>()
let compiled = (comp: string, d: PropSchema, extra: Set<string>) => {
  let names = components.get(d)
  let held = !extra.size && names?.get(comp)
  if (held) return held
  let read = new Map(
    Object.entries(d.properties ?? {}).map(([prop, s]) => [
      prop,
      propOf(comp, prop, s, extra, !!d.required?.includes(prop)),
    ]),
  )
  let made: Compiled = { read }
  if (!extra.size) {
    if (!names) components.set(d, names = new Map())
    names.set(comp, made)
  }
  return made
}

// The query surface. Every method answers over the loaded documents; none
// reads a global.
export type Vocab = {
  docs: VocabDoc[]
  keywords: Keywords[] // the extension vocabularies this load registered
  comps: string[] // component names a client may write, alphabetical
  all: string[] // every declared component name, alphabetical
  /** every kind's name, in the order they name an entity: alphabetical,
   * refined by containment, `before` and marks (./kinds.ts) */
  kinds: string[]
  /** One kind's declaration, loaded; undefined for a name no kind has. */
  kind: (name: string) => Kind | undefined
  /** A component, named as its reader writes it: by the name it is held
   * under, a bare label, a full label (`yourname/trip:cost`) or an identity.
   * Undefined for a name that means no component, or several. */
  comp: (name: string) => CompInfo | undefined
  /** The name a component is held under here, from any name its reader may
   * write; undefined for one that means no component, and {@link Ambiguous}
   * for a bare label that means several. */
  held: (name: string) => string | undefined
  /** This vocabulary as a reader in namespace `ns` reads it (none: a reader
   * outside every vocabulary). Every name it takes and gives is a label as
   * that reader writes it: a bare label where the reader reads it as that
   * word, a full label otherwise (./reading.ts says the order a bare label is
   * read in). Where it reads every name as this one does, it is this one. */
  in: (ns?: Namespace, reader?: Reader) => Vocab
  /** What an identity names here: a component, by the name it is held under,
   * one of its properties, or a kind; undefined for an identity no word
   * loaded here carries. */
  word: (id: string) => Word | undefined
  /** A component's `$defs` entry as its documents declare it, with every
   * `extends` applied — the JSON Schema itself, for a reader that wants the
   * schema rather than the facts this load read out of it. */
  def: (name: string) => PropSchema | undefined
  props: (comp: string) => string[] // readable properties (writable ∪ stamped)
  /** One property, by its label or its identity. */
  prop: (comp: string, prop: string) => Prop | undefined
  /** Declared indexes plus automatic reference indexes — see
   * {@link Index}. A storage adapter renders them; nothing else reads them. */
  indexes: (comp: string) => Index[]
  /** The properties this component's entities are identified by — the tuple the
   * id is derived from, in derivation order, or `[]` for the ordinary
   * component whose entities take a minted id. @yaks/graph does the
   * derivation. */
  identity: (comp: string) => Identity
  /** A dotted path → the hops it names: `comp.prop` pairs, each past the
   * first read on the entity the reference before it names, and a component
   * alone at the end (`.task`, `.comment.target.task`). A name alone is
   * always a component; a property is named with its component, and a name
   * only properties hold is refused with the forms that name it. Pass `facet`
   * for a presence test (`.name`, `!name`, `?name`): a name nothing declares
   * is then a component too, since a presence test needs no schema. */
  aim: (path: string, facet?: boolean) => Hop[]
  assoc: (name: string) => Assoc | undefined
  /** Where a path walked forward turns back: the index of the first reverse
   * association standing where a hop's component would (`.grant.app.members`
   * → 2), or -1. The name after a component is that component's property, so
   * `.effect.attempts` never turns back, whatever else is called `attempts`. */
  turn: (path: readonly string[]) => number
  /** Every reverse association, by name. */
  assocs: () => [string, Assoc][]
  kindOf: (has: Record<string, unknown>) => string
  deaths: (word: Death) => [string, string][]
  refProps: () => [string, string][]
  check: (
    comp: string,
    value: Record<string, unknown>,
    opts?: { stamped?: boolean },
  ) => string[]
}

/** What a word's identity names in a vocabulary: a component or one of its
 * properties, as a {@link Hop} names them, or a kind. */
export type Word = { comp: string; prop?: string } | { kind: string }

// The composite lists a component declares under one keyword, each entry read
// to its properties and the properties it needs present. A boolean there is
// the property form of the keyword misplaced, and means nothing about the whole
// table, so it reads as no list rather than as an error the meta-schema
// already raises.
export let composite = (
  c: Composite,
): { props: string[]; present?: string[] } =>
  Array.isArray(c) ? { props: c } : c
let lists = (v: unknown): { props: string[]; present?: string[] }[] =>
  Array.isArray(v) ? (v as Composite[]).map(composite) : []

// The properties a component's entities are identified by, from the two forms
// that declare them: a property's own `identity` flag, or the component's list
// when the identity spans several properties. The list wins when both are
// there, because the list is what fixes the order, and the order is part of the
// string the id is derived from.
//
// One tuple per component and never a list of them — `unique` may hold several
// because a row can be unique several ways, but an entity has one id.
let identityOf = (comp: PropSchema | undefined): Identity => {
  if (!comp) return []
  let said = comp.identity
  if (Array.isArray(said)) return [...said]
  return Object.entries(comp.properties ?? {})
    .filter(([, s]) => s.identity === true)
    .map(([prop]) => prop)
}

// A component's indexes, from the two forms that declare them: a property's own
// `unique`/`index` flag is that one property's index, and the component's lists
// are the composites. Property flags come first, in declaration order, then
// the composites; a pair of properties declared twice is one index, unique if
// either form asked for uniqueness. Every stored reference is indexed too,
// unless it already leads a declared index (including a composite identity).
let indexesOf = (
  comp: PropSchema | undefined,
  read: (prop: string) => Prop | undefined,
): Index[] => {
  if (!comp) return []
  let out = new Map<string, Index>()
  let add = (names: string[], unique: boolean, present?: string[]) => {
    if (!names.length) return
    let key = names.join(',')
    let had = out.get(key)
    let index: Index = { props: names, unique: unique || !!had?.unique }
    // The narrower form wins: an index asked for over present rows only stays
    // partial even where the plain tuple was also declared.
    let where = present ?? had?.present
    if (where) index.present = where
    out.set(key, index)
  }
  for (let [prop, s] of Object.entries(comp.properties ?? {})) {
    // A computed property has no cell to index.
    if (read(prop)?.computed !== false) continue
    if (s.unique === true) add([prop], true)
    else if (s.index === true) add([prop], false)
  }
  for (let c of lists(comp.unique)) add(c.props, true, c.present)
  for (let c of lists(comp.index)) add(c.props, false, c.present)
  // An identity is unique by construction — two rows sharing the value would
  // be one entity — so the index states what the derivation already
  // guarantees, and a store that somehow held two rejects the second one.
  add(identityOf(comp).filter((p) => read(p)?.computed === false), true)
  let leading = new Set([...out.values()].map((i) => i.props[0]))
  for (let prop of Object.keys(comp.properties ?? {})) {
    let p = read(prop)
    if (p && !p.computed && p.category == 'ref' && !leading.has(prop)) {
      add([prop], false)
    }
  }
  return [...out.values()]
}

// The spine component, and the identity property no vocabulary declares. A
// document declares what `entity` stores beside it (the number a store mints);
// the `eid` is built in — every entity has one — so the loader routes it
// (`.entity.eid=`, `.entity.eid=`) rather than making each vocabulary re-declare it.
// It stays out of `props()` on purpose: an id is not prose and has no column
// of its own, so it never reaches a text index, an embedding, or a component's
// DDL.
let SPINE = 'entity'
let EID = 'eid'

// A property's type in the words its schema declared it: the JSON Schema
// `type`, with the `format` or `ref` that refines it (`date-time string`,
// `ref task`), a union's members (`string|array`), or an enum's values.
let FORMAT: Partial<Record<Scalar, string>> = {
  time: 'date-time',
  url: 'uri',
  query: 'query',
  json: 'json',
  priority: 'priority',
}
let declared = (c: Prop): string => {
  if (c.category == 'enum') return c.values!.join('|')
  if (c.category == 'ref') return `ref ${c.ref}`
  if (c.scalar == 'jsonb') return c.types!.join('|')
  if (c.scalar == 'binary') return 'bytes'
  let type = c.scalar == 'bool'
    ? 'boolean'
    : c.scalar == 'number' || c.scalar == 'priority'
    ? (c.affinity == 'integer' ? 'integer' : 'number')
    : 'string'
  let format = FORMAT[c.scalar!]
  return format ? `${format} ${type}` : type
}

/** A component's whole shape in one line, for an error message that teaches:
 * `doc has title (string), body (string)`. An error naming only what it failed
 * to parse teaches nothing. */
export let shapeOf = (v: Vocab, comp: string): string => {
  // The spine's eid is no declared property, and it is what an entity is
  // named by, so it leads.
  let said = [
    ...comp == SPINE ? [`${EID} (${NAMED})`] : [],
    ...v.props(comp).map((p) => `${p} (${declared(v.prop(comp, p)!)})`),
  ]
  if (!said.length) {
    return `${comp} is a marker with no properties. Use .${comp} to test for ` +
      `presence or !${comp} to test for absence`
  }
  return `${comp} has ${said.join(', ')}`
}

// How the spine's eid is read, said where its shape is.
let NAMED =
  "the entity's id: .entity.eid=T-12 or .entity.eid=#<hex>; graph_show reads one"

/**
 * The refusal for comparing or ordering by a property that holds a JSON value
 * (an object, an array or a union), which has no scalar to compare: what can
 * be asked of it, and how to reach the rows by something else.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { jsonValued } from '@yaks/vocab'
 * assertEquals(
 *   jsonValued('call.args'),
 *   '.call.args holds a JSON value — it can be projected (.fields=call.args) ' +
 *     'or tested for presence (.call.args); find the rows by another ' +
 *     'property or by bare search words, and read the value in what comes back',
 * )
 * ```
 */
export let jsonValued = (path: string): string =>
  `.${path} holds a JSON value — it can be projected (.fields=${path}) or ` +
  `tested for presence (.${path}); find the rows by another property or by ` +
  `bare search words, and read the value in what comes back`

// The edits that turn one word into another (Levenshtein): one row of the
// table at a time.
let edits = (a: string, b: string): number => {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diag = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      let up = row[j]
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        diag + (a[i - 1] == b[j - 1] ? 0 : 1),
      )
      diag = up
    }
  }
  return row[b.length]
}

/**
 * The names closest to a word nothing declares, best first and at most
 * `most`: a slip (within a third of the word in edits; one edit from a
 * two-letter word only where the name holds it), a name that opens with the
 * other, or one holding the word as a part of its snake_case name,
 * ranked as a one-letter slip. With `fallback`, return the closest names even
 * when none looks like a slip.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { nearest } from '@yaks/vocab'
 * assertEquals(nearest('recipy', ['recipe', 'doc', 'recipes']), [
 *   'recipe',
 *   'recipes',
 * ])
 * assertEquals(nearest('individual', ['individuals', 'doc']), ['individuals'])
 * assertEquals(nearest('sandwich', ['recipe', 'doc']), [])
 * assertEquals(nearest('letter', ['meter', 'outreach_letter', 'doc']), [
 *   'outreach_letter',
 *   'meter',
 * ])
 * assertEquals(nearest('in', ['on', 'id', 'index']), [])
 * assertEquals(nearest('id', ['eid', 'in']), ['eid'])
 * ```
 */
export let nearest = (
  word: string,
  names: string[],
  most = 3,
  { fallback = false } = {},
): string[] => {
  let w = word.toLowerCase()
  let opens = (a: string, b: string) => b.length >= 3 && a.startsWith(b)
  let ranked = names.filter((name) => name != word).map((name) => {
    let n = name.toLowerCase()
    let part = w.length >= 3 && n.split('_').includes(w)
    let d = part ? 1 : edits(w, n)
    // One edit is half a two-letter word, so it is a slip only of a name
    // that holds it whole: `id` of `eid`, but `in` of neither `on` nor `id`.
    let slip = w.length >= 3
      ? Math.max(1, Math.floor(w.length / 3))
      : n.includes(w)
      ? 1
      : 0
    let near = d <= slip || opens(w, n) || opens(n, w)
    return { name, d, near }
  })
  let close = ranked.filter((c) => c.near)
  return (fallback && !close.length ? ranked : close)
    .sort((a, b) => a.d - b.d || a.name.localeCompare(b.name)).slice(0, most)
    .map((c) => c.name)
}

// The words a write says beside its components, which a read never selects:
// what each is, and what a query reads instead.
let WRITTEN: Record<string, string> = {
  where:
    'a query is its own where: write each clause as .component.property=value, joined with & or |',
  $was:
    "$was guards a write with the hash of a value as it was read, and no row holds one; a query reads a row's history as .updated.at and .created.at",
}

// Words other query languages spell as operators, which this grammar writes
// as a value or a sign (@yaks/query README, Predicates and text), each said
// with the path the caller put it after.
let OPERATORS: Record<string, (path: string) => string> = {
  in: (p) =>
    `a query has no in: a list value is membership, so .${p}=a,b,c equals ` +
    'any of a, b and c',
  like: (p) =>
    `a query has no like: ~= matches part of a value, so .${p}~=cake holds ` +
    'cake anywhere in it',
  not: (p) =>
    `a query has no not: != excludes a value (.${p}!=done), and !comp is a ` +
    "component's absence",
}
OPERATORS.contains = (p) => OPERATORS.like(p).replace('no like', 'no contains')

/**
 * The refusal for a name nothing in this vocabulary declares, said where a
 * query named it: the declared names it is closest to, so a slip is fixed in
 * one more call, what a write's own word is instead of a component, or how
 * the grammar writes an operator another query language spells as a word,
 * after the path the caller put it on (`at`).
 *
 * ```ts
 * import { assertEquals, assertStringIncludes } from '@std/assert'
 * import { unknownName } from '@yaks/vocab'
 * assertEquals(
 *   unknownName('recipy', ['recipe', 'doc']),
 *   'unknown prop: .recipy (closest declared: .recipe)',
 * )
 * assertEquals(
 *   unknownName('sandwich', ['recipe']),
 *   'unknown prop: .sandwich — no component is named sandwich, and none has ' +
 *     'a property of that name',
 * )
 * assertStringIncludes(unknownName('$was', []), '.updated.at and .created.at')
 * assertEquals(
 *   unknownName('in', ['blocked'], () => ['on'], 'task.status'),
 *   'unknown prop: .in — a query has no in: a list value is membership, so ' +
 *     '.task.status=a,b,c equals any of a, b and c',
 * )
 * ```
 */
export let unknownName = (
  word: string,
  names: string[],
  props: (comp: string) => string[] = () => [],
  at = 'comp.prop',
): string => {
  let said = `unknown prop: .${word}`
  if (WRITTEN[word]) return `${said} — ${WRITTEN[word]}`
  let op = OPERATORS[word.toLowerCase()]
  if (op) return `${said} — ${op(at)}`
  // A slip of a component's name, else of a property's, said with its
  // component.
  let near = nearest(word, names).map((n) => `.${n}`)
  if (!near.length) {
    let forms = names.flatMap((c) => props(c).map((p) => `${c}.${p}`))
    let close = new Set(
      nearest(word, [...new Set(forms.map((f) => f.split('.')[1]))]),
    )
    near = forms.filter((f) => close.has(f.split('.')[1])).slice(0, 3)
      .map((f) => `.${f}`)
  }
  return near.length
    ? `${said} (closest declared: ${near.join(', ')})`
    : `${said} — no component is named ${word}, and none has a property of ` +
      `that name`
}

/**
 * The refusal for a kind's name where a query reads it as a component: on a
 * path, or where nothing reads the kind as what it is (a query's reads do,
 * @yaks/query `kinded`). It says the components the kind is.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { kindNamed } from '@yaks/vocab'
 * assertEquals(
 *   kindNamed('booking', ['seat', 'venue']),
 *   '.booking names a kind, not a component: a booking is .seat&.venue, ' +
 *     'and a property is named on one of them (.seat.<prop>)',
 * )
 * ```
 */
export let kindNamed = (kind: string, is: string[]): string =>
  `.${kind} names a kind, not a component: a${
    /^[aeiou]/.test(kind) ? 'n' : ''
  } ${kind} is ${is.map((c) => `.${c}`).join('&')}, and a property is named ` +
  `on one of them (.${is[0]}.<prop>)`

/** The refusal for a name this vocabulary has no component of, where a query
 * names it alone or after a path (`at`): a kind's name says the components
 * the kind is ({@link kindNamed}), and any other the names it is closest to
 * ({@link unknownName}). */
export let unknownWord = (
  v: Pick<Vocab, 'all' | 'props' | 'kind'>,
  word: string,
  at?: string,
): string => {
  let kind = v.kind(word)
  return kind?.is.length
    ? kindNamed(word, kind.is)
    : unknownName(word, v.all, v.props, at)
}

/** The refusal for properties a component does not declare: one wording,
 * whether a query or a write named them. Where it can name nothing the caller
 * was closer to (a marker has no properties to be close to), the component is
 * explained by its description, the one place what it means is said, such as
 * where a value it does not hold is read instead. */
export let unknownProps = (v: Vocab, comp: string, props: string[]): string => {
  let own = [...comp == SPINE ? [EID] : [], ...v.props(comp)]
  let near = [...new Set(props.flatMap((p) => nearest(p, own)))]
  let first = (c: string) =>
    v.props(c).find((q) => v.prop(c, q)?.scalar != 'jsonb')
  // A kind the component references (`call.tool`, where `call.to` is a ref
  // tool) is reached through that reference, beside any own property that
  // says the same thing (`call.name`).
  let through = props.flatMap((p) => {
    let q = own.find((q) => v.prop(comp, q)?.ref == p)
    let f = q && first(p)
    if (!q || !f) return []
    let same = own.includes(f) ? ` or its own .${comp}.${f}=…` : ''
    return [
      `${comp}.${q} references the ${p}: .${comp}.${q}.${p}.${f}=…${same}`,
    ]
  })
  // A component named as a property (`person.email`) is worn beside it.
  let worn = through.length ? [] : props.flatMap((p) => {
    if (p == comp || !v.comp(p)) return []
    let f = first(p)
    let presence = `.${comp}&.${p}`
    return [
      f ? `${presence}.${f}=… or ${presence} for presence` : presence,
    ]
  })
  let kind = v.kind(comp)
  let companions = kind?.is.includes(comp)
    ? [...new Set([...kind.is, ...Object.keys(kind.with)])]
      .filter((c) => c != comp)
    : []
  let named = props.flatMap((p) => {
    let paths = companions.filter((c) => v.prop(c, p)).map((c) => `${c}.${p}`)
    return paths.length ? [`${p} is ${paths.join(' or ')}`] : []
  })
  // An operator word put after a component (`.task.in=a,b`).
  let ops = props.flatMap((p) => {
    let op = OPERATORS[p.toLowerCase()]
    return op ? [op(`${comp}.<prop>`)] : []
  })
  let about =
    near.length || through.length || worn.length || named.length || ops.length
      ? ''
      : v.comp(comp)?.description
  return `unknown ${props.length > 1 ? 'properties' : 'property'}: ${
    props.map((p) => `${comp}.${p}`).join(', ')
  }${
    near.length
      ? ` (closest declared: ${near.map((p) => `${comp}.${p}`).join(', ')})`
      : ''
  } — ${props.includes(comp) ? `Use .${comp} to test for presence. ` : ''}${
    ops.map((t) => `${t}; `).join('')
  }${named.map((t) => `${t}. `).join('')}${
    through.map((t) => `${t}; `).join('')
  }${
    worn.length
      ? `a component is no property of another, so an entity wearing both ` +
        `is ${worn.join(' or ')}; `
      : ''
  }${shapeOf(v, comp)}${about ? `; ${comp}: ${about}` : ''}`
}

/**
 * The refusal for components this vocabulary does not declare. A component is
 * a whole word, not a slip inside one, so the sentence says where words come
 * from rather than listing every word there is. A program whose callers have
 * words of their own to declare says where, in `teach`.
 *
 * ```ts
 * import { unknownComps } from '@yaks/vocab'
 * unknownComps(['recipy'])
 * // 'unknown component: recipy — nothing this vocabulary was loaded from declares it'
 * unknownComps(['recipy'], ' — declare it in vocab.json')
 * // 'unknown component: recipy — declare it in vocab.json'
 * ```
 */
export let unknownComps = (comps: string[], teach?: string): string =>
  `unknown ${comps.length > 1 ? 'components' : 'component'}: ${
    comps.join(', ')
  }${
    teach ??
      ` — nothing this vocabulary was loaded from declares ${
        comps.length > 1 ? 'them' : 'it'
      }`
  }`

/**
 * Who is told about a write to a component — `server` for a component this
 * vocabulary does not declare, which is the same answer a declared component
 * with no `sync` keyword gives, so a caller never has to special-case the
 * unknown.
 */
export let syncOf = (v: Vocab, comp: string): Sync =>
  v.comp(comp)?.sync ?? 'server'

// The scalars declared `"type": "string"`.
let STRINGS: (Scalar | undefined)[] = ['text', 'time', 'url', 'query', 'json']

/**
 * A patch with each string property's value cast to a string: a number or a
 * boolean becomes its text, an object or an array its JSON text, and a null
 * still clears the property. The schema says what a reader gets back, and
 * casting on the way in is what keeps that promise — the stored row, the
 * transaction a write returns and what every other client is told all carry
 * the same string. A reference names an entity rather than holding a value,
 * so it is left as sent.
 */
export let cast = (
  v: Vocab,
  comp: string,
  patch: Record<string, unknown>,
): Record<string, unknown> => {
  let out: Record<string, unknown> = {}
  for (let k of Object.keys(patch)) {
    let val = patch[k]
    let c = val == null || typeof val == 'string' ? undefined : v.prop(comp, k)
    let text = c &&
      (c.category == 'enum' ||
        (c.category == 'scalar' && STRINGS.includes(c.scalar)))
    out[k] = !text
      ? val
      : typeof val == 'object'
      ? JSON.stringify(val)
      : String(val)
  }
  return out
}

/** How long one of a component's values lives — `forever` for an unknown
 * component. */
export let durableOf = (v: Vocab, comp: string): string =>
  v.comp(comp)?.durable ?? 'forever'

/** How often a writer's value of a component is taken, in milliseconds —
 * `null` for a component that declares no pace, or that this vocabulary does
 * not declare, and every write is taken as it is made. */
export let paceOf = (v: Vocab, comp: string): number | null =>
  v.comp(comp)?.pace ?? null

/** The query a stored entity must match before saving a peer-relayed value
 * — `null` when the component declares no query or is unknown. */
export let saveOf = (v: Vocab, comp: string): string | null =>
  v.comp(comp)?.save ?? null

/** Query selecting a component's rows for expiration; absent expires nothing. */
export let expireOf = (v: Vocab, comp: string): string | null =>
  v.comp(comp)?.expire ?? null

// What each list of documents and keywords was loaded into, by the identity of
// each: a vocabulary never changes once loaded, so the same documents load into
// the same one, and what every package keeps per vocabulary (compiled checks,
// query plans, table layouts) is worked out once for every graph that speaks
// it. A document is not edited once loaded; an edit is a new document.
type Loaded = { next: WeakMap<object, Loaded>; vocab?: Vocab }
let loaded: Loaded = { next: new WeakMap() }
let KEYWORDS = {}

/** The vocabulary these documents declare, with these keywords: the same
 * object for the same documents and keywords. */
export let loadVocab = (
  input: VocabDoc | VocabDoc[],
  keywords: Keywords[] = [],
): Vocab => {
  let docs = Array.isArray(input) ? input : [input]
  let at = [...docs, KEYWORDS, ...keywords].reduce((at: Loaded, key) => {
    let next = at.next.get(key)
    if (!next) at.next.set(key, next = { next: new WeakMap() })
    return next
  }, loaded)
  return at.vocab ??= composed(docs, keywords)
}

let composed = (docs: VocabDoc[], keywords: Keywords[]): Vocab => {
  let compWords = new Set(keywords.flatMap((k) => k.comp ?? []))
  let propWords = new Set(keywords.flatMap((k) => k.prop ?? []))
  // Merge every document's component entries into one table. `$defs` is JSON
  // Schema's own reuse slot, so an entry carries a marker saying what it is:
  // `component: true` is a component, `tool: true` is a tool declaration
  // (tools.ts `toolsIn` reads those), `rule: true` is a rule (rules.ts
  // `rulesIn`) and `effect: true` is an effect (effects.ts `effectsIn`), all of
  // which this loader skips, and anything else is an ordinary subschema
  // somebody `$ref`s. An entry with properties and no
  // marker is the one case that throws rather than being skipped: it is a
  // component whose marker was forgotten, and creating no table for it would
  // silently lose the component.
  //
  // An entry's key is its label. A label one namespace declares names its
  // component here; where several namespaces declare it, each is a word of
  // its own, held under its identity (`apart`), and a label said twice any
  // other way is a conflict.
  //
  // `extends: true` is the one entry that may name a component another document
  // already declared: it adds properties to it (`extended`). Those are applied
  // after every document is read, so the order the documents were loaded in
  // decides nothing.
  let declared = new Map<string, Declared[]>()
  let adding: [string, PropSchema][] = []
  for (let doc of docs) {
    for (let [name, said] of Object.entries(doc.$defs ?? {})) {
      // A tool, rule or effect is no word, and is read where it is offered or
      // run: copying it here would read every tool's input at load.
      if (
        said?.tool === true || said?.rule === true || said?.effect === true
      ) continue
      let schema = unnoted(said)
      if (schema?.component !== true) {
        if (schema?.properties || schema?.type == 'object') {
          throw new Error(
            `'${name}' has properties but says no "component": true — mark it a ` +
              'component, or it is an ordinary subschema and no table',
          )
        }
        continue
      }
      if (schema.extends === true) {
        adding.push([name, schema])
        continue
      }
      let ns = namespaceOf(doc, schema.label ?? doc.label)
      declared.set(name, [...declared.get(name) ?? [], { schema, ns }])
    }
  }
  let defs: Record<string, PropSchema> = {}
  let from: Record<string, Namespace> = {} // a component → its namespace
  let labels: Record<string, string> = {} // a component → its label
  for (let [label, all] of declared) {
    for (let [key, { schema, ns }] of apart('component', label, all)) {
      defs[key] = schema
      labels[key] = label
      if (ns) from[key] = ns
    }
  }
  let held = new Map<string, string>() // a component's identity → its key
  for (let [name, schema] of Object.entries(defs)) {
    let id = idOf(schema.$id)
    if (id) held.set(id, name)
  }
  // What an `extends` entry adds to: the component its `$id` names, else the
  // one its label names, which may not be a label several namespaces share.
  let extendee = (name: string, schema: PropSchema): string => {
    let id = idOf(schema.$id)
    if (id) return held.get(id) ?? name
    let all = declared.get(name) ?? []
    if (all.length < 2) return name
    throw new Error(
      `'${name}' extends a component ${namespaces(all)} each declare — ` +
        'give the entry the $id of the one it extends',
    )
  }
  for (let [name, schema] of adding) {
    let key = extendee(name, schema)
    if (!defs[key] && rungsOnly(schema)) continue
    defs[key] = extended(name, defs[key], schema)
  }
  // A component's `status` ladder gives it a computed `status` property, which
  // every reader below then sees as declared (./status.ts).
  let ladders: Record<string, Ladder> = {}
  for (let [name, schema] of Object.entries(defs)) {
    let l = ladderOf(name, schema, defs)
    if (!l) continue
    ladders[name] = l
    defs[name] = {
      ...schema,
      properties: { ...schema.properties, status: statusProp(l) },
    }
  }
  let lists: Record<string, string[]> = {}
  for (let [name, schema] of Object.entries(defs)) {
    lists[name] = found(name, schema, defs)
  }

  let props = (name: string): Record<string, PropSchema> =>
    defs[name]?.properties ?? {}
  let names = Object.keys(defs).sort()

  // A vocabulary never changes once loaded, so what it says about each
  // component and property is read out of the schemas once, here, and every
  // question after that is a lookup: admission asks about every property of
  // every write.
  let read = new Map<string, Compiled>()
  for (let comp of names) {
    let d = defs[comp]
    read.set(comp, compiled(comp, d, propWords))
  }
  let propFor = (comp: string, prop: string): Prop | undefined =>
    read.get(comp)?.read.get(prop)

  // A computed component is written by nobody, so no client writes it either.
  let wire = (name: string) =>
    defs[name].wire !== false && defs[name].computed !== true
  let compNames = names.filter(wire)

  // A mark records something that happened to an entity: the graph fills its
  // server-owned `at`, and a `by` or `via`, the first time it is written
  // (@yaks/graph ./stamp.ts).
  let mark = (name: string) => {
    let own = props(name)
    return !!own.at?.stamped && !!(own.by?.stamped || own.via?.stamped)
  }

  // Every kind, by name; a component names a kind when it is the kind of its
  // own name.
  let kindsBy = kindsIn(docs, defs, from, labels)
  let own = (name: string) => kindsBy.get(name)?.is.join() == name

  let info = (name: string): CompInfo => {
    let d = defs[name]
    let entries = Object.keys(props(name))
    let id = idOf(d.$id)
    return {
      name,
      label: labels[name],
      ...(id ? { id } : {}),
      description: d.description,
      wire: wire(name),
      computed: d.computed === true,
      embed: d.embed !== false,
      found: d.found !== false,
      notice: d.notice === true,
      journal: d.journal !== false,
      kind: own(name),
      mark: mark(name),
      ...(from[name] ? { namespace: from[name] } : {}),
      before: own(name) ? kindsBy.get(name)!.before : d.before ?? [],
      // A computed property is readable, never writable — like a stamped one,
      // but with no storage either.
      writable: entries.filter((p) => {
        let s = props(name)[p]
        return !s.stamped && s.computed !== true
      }),
      stamped: entries.filter((p) => props(name)[p].stamped),
      sync: said(d.sync),
      durable: kept(d.durable),
      pace: paced(d.pace),
      save: saved(d.save),
      expire: saved(d.expire),
      search: lists[name],
      ...(ladders[name] ? { ladder: ladders[name] } : {}),
      keywords: carried(d, compWords),
    }
  }
  let infos = new Map<string, CompInfo>()
  let infoOf = (name: string): CompInfo | undefined => {
    let got = infos.get(name)
    if (got || !Object.hasOwn(defs, name)) return got
    infos.set(name, got = info(name))
    return got
  }

  // The readable routing table: every component to its readable properties. A
  // component with no properties routes with an empty list (`.about` is then a
  // presence test).
  let routes = new Map<string, string[]>()
  for (let name of names) routes.set(name, Object.keys(props(name)))

  // The components that declare a property of this name, for the refusal of a
  // property named alone; a `_` component describes the vocabulary itself, so
  // it follows the application's own, as completion orders them. The spine's
  // eid is declared by no document.
  let homes = (prop: string): string[] =>
    prop == EID ? [SPINE] : names
      .filter((c) => routes.get(c)!.includes(prop))
      .toSorted((a, b) => Number(a[0] == '_') - Number(b[0] == '_'))

  // A plural that is a name, not English: uniqueness is the goal, so 'shelf' →
  // 'shelfs' is fine and 'series' → 'series' stays put.
  let plural = (s: string) =>
    s.endsWith('y') ? `${s.slice(0, -1)}ies` : s.endsWith('s') ? s : `${s}s`

  // The reverse associations, derived from the reference properties and never
  // hand listed, so a new reference property earns its reverse name for free. A
  // component with one reference is named by its plural (`review.book` →
  // `.reviews`); several references disambiguate with the property
  // (`loan.book`, `loan.member` → `.loans_book`, `.loans_member`). A forward
  // name always wins, so a plural already taken (`_lens.package`, whose plural
  // is its own name, or a second component pluralizing alike) names the
  // property too: `._namespace !_lens_package` is the namespaces no `_lens`
  // names.
  let assocs = new Map<string, Assoc>()
  let taken = (name: string) => routes.has(name) || assocs.has(name)
  for (let comp of names) {
    let refs = Object.keys(props(comp))
      .filter((p) => propFor(comp, p)!.category == 'ref')
    for (let prop of refs) {
      let name = [plural(comp), `${plural(comp)}_${prop}`]
        .slice(refs.length == 1 ? 0 : 1)
        .find((n) => !taken(n))
      if (name) assocs.set(name, { comp, prop })
    }
  }

  // A computed component's references are columns of another package's rows,
  // owned by entities outside the entity table: a reverse read over stored
  // rows (a delete's, `.refs=`) has nothing to find there, so they are not
  // listed. Its reverse associations are derived all the same, above.
  let refs = names.filter((comp) => defs[comp].computed !== true).flatMap((
    comp,
  ) =>
    [...read.get(comp)!.read.values()].flatMap((c) =>
      c.category == 'ref' ? [[comp, c.prop] as [string, string]] : []
    )
  )
  let dying = new Map<string, [string, string][]>()

  let kinds = orderKinds(kindsBy, mark)

  // Every identity a word here carries, to what it names. One identity on two
  // words is a mistake in whatever minted them, so it is refused.
  let words = new Map<string, Word>()
  let name = (w: Word) =>
    'kind' in w ? w.kind : w.prop ? `${w.comp}.${w.prop}` : w.comp
  let carry = (id: string | undefined, w: Word) => {
    if (!id) return
    let had = words.get(id)
    if (had) {
      throw new Error(
        `'${name(had)}' and '${name(w)}' are both declared as ${id}`,
      )
    }
    words.set(id, w)
  }
  for (let comp of names) {
    carry(idOf(defs[comp].$id), { comp })
    for (let p of read.get(comp)!.read.values()) {
      carry(p.id, { comp, prop: p.prop })
    }
  }
  // A component that is the kind of its own name is one word with it.
  for (let k of kindsBy.values()) {
    let w = k.id ? words.get(k.id) : undefined
    if (!w || 'kind' in w || w.comp != k.name) carry(k.id, { kind: k.name })
  }
  let shapes = kinds.map((k) => kindsBy.get(k)!.is)

  // Every word a reader may name, components and kinds apart, and how this
  // vocabulary reads them: in no namespace, where every name it holds reads
  // back as itself.
  let compsNamed = names.map((n): Named => ({
    held: n,
    label: labels[n] ?? n,
    ...(from[n] ? { ns: from[n] } : {}),
    ...(idOf(defs[n].$id) ? { id: idOf(defs[n].$id) } : {}),
  }))
  let kindsNamed = [...kindsBy.values()].map((k): Named => ({
    held: k.name,
    label: k.label,
    ...(k.namespace ? { ns: k.namespace } : {}),
    ...(k.id ? { id: k.id } : {}),
  }))
  let plain = reading(compsNamed, undefined)
  let plainKinds = reading(kindsNamed, undefined)

  // A property of a held component, by its label, its identity, or a label
  // it was called before a rename (`was`, by component) that no property of
  // it holds now.
  let propOf = (
    comp: string,
    name: string,
    was?: Map<string, Map<string, string>>,
  ): string | undefined => {
    let own = read.get(comp)?.read
    if (!own || own.has(name)) return own && name
    let w = words.get(name)
    if (w && 'prop' in w && w.comp == comp) return w.prop
    return was?.get(comp)?.get(name)
  }

  // A dotted path → the hops it names, read with `comp` and `prop` turning
  // each segment into the name it is held under, and `out` giving each hop's
  // component the name its reader writes. `self` is the vocabulary a refusal
  // teaches from.
  let aimer = (
    self: () => Vocab,
    comp: (seg: string) => string | undefined,
    prop: (comp: string, seg: string) => string | undefined,
    out: (held: string) => string,
  ) => {
    let aimed = new Map<string, Hop[]>()
    let refusals = new Map<string, { prop: string; message: string }>()
    return (path: string, facet?: boolean): Hop[] => {
      // A bare unknown name answers differently with `facet`; nothing else
      // does. A refusal is thrown afresh each time it is asked.
      let key = facet ? `?${path}` : path
      let held = aimed.get(key)
      if (held) return held
      // A refusal's words are this vocabulary's, so they are found once: a
      // read that asks every app's vocabulary about a word few of them
      // declare would otherwise measure its distance to every name, each time.
      let no = refusals.get(key)
      if (no) throw new Unknown(no.prop, no.message)
      let segs = path.split('.')
      let local = segs.length <= 2 && out === same
        ? read.get(segs[0])
        : undefined
      let known = local?.paths?.get(path)
      if (known) {
        aimed.set(key, known)
        return known
      }
      let v = self()
      let hops: Hop[] = []
      let refuse = (prop: string, message: string): never => {
        refusals.set(key, { prop, message })
        throw new Unknown(prop, message)
      }
      for (let i = 0; i < segs.length; i += 2) {
        let [a, b] = [segs[i], segs[i + 1]]
        // Every entity has one eid, on its spine, so `eid` alone compared or
        // ordered by can mean only that one; tested for alone, it asks
        // nothing.
        if (a == SPINE && b == EID || i == 0 && a == EID && !b && !facet) {
          hops.push({ comp: SPINE, prop: EID })
          continue
        }
        let c = comp(a)
        if (!c) {
          let at = homes(a)
          if (at.length) {
            refuse(a, unqualified(a, at, (c) => v.comp(c)?.description))
          }
          if (b != null || !facet) {
            refuse(
              a,
              unknownWord(v, a, segs.slice(0, i).join('.') || undefined),
            )
          }
          hops.push({ comp: a, prop: '' })
          continue
        }
        if (b == null) {
          hops.push({ comp: out(c), prop: '' })
          continue
        }
        let p = prop(c, b)
        if (!p) refuse(`${a}.${b}`, unknownProps(v, out(c), [b]))
        hops.push({ comp: out(c), prop: p! })
      }
      aimed.set(key, frozen(hops))
      if (local) (local.paths ??= new Map()).set(path, hops)
      return hops
    }
  }
  let same = (name: string) => name
  // A name the reader writes → the name it is held under, quietly: a name
  // that means several words is no one component to look up.
  let quiet = (f: () => string | undefined): string | undefined => {
    try {
      return f()
    } catch (e) {
      if (e instanceof Ambiguous) return undefined
      throw e
    }
  }
  let look = (name: string): string | undefined =>
    Object.hasOwn(defs, name) ? name : quiet(() => plain.meant(name)?.held)

  // Where a path leads, what a component indexes and what identifies its
  // entities are facts of the vocabulary, asked of it for every clause a query
  // compiles and every bundle a write carries: each is worked out once, and
  // handed out frozen, since every caller shares it.
  let v: Vocab = {
    docs,
    keywords,
    comps: compNames,
    all: names,
    kinds,
    comp: (name) => {
      let held = infoOf(name)
      if (held) return held
      let c = look(name)
      return c ? infoOf(c) : undefined
    },
    held: (name) => Object.hasOwn(defs, name) ? name : plain.meant(name)?.held,
    in: (ns, reader) => viewOf(ns, reader),
    word: (id) => words.get(id),
    def: (name) => defs[name] ?? defs[look(name) ?? ''],
    props: (comp) => routes.get(comp) ?? routes.get(look(comp) ?? '') ?? [],
    prop: (comp, prop) => {
      let got = propFor(comp, prop)
      if (got) return got
      let c = look(comp), p = c && propOf(c, prop)
      return p ? propFor(c!, p) : undefined
    },
    indexes: (name) => {
      let comp = look(name) ?? name
      let held = read.get(comp)
      if (!held) return frozen([])
      return held.indexes ??= frozen(
        indexesOf(defs[comp], (p) => propFor(comp, p)),
      )
    },
    identity: (name) => {
      let comp = look(name) ?? name
      let held = read.get(comp)
      if (!held) return frozen([])
      return held.identity ??= frozen(identityOf(defs[comp]))
    },
    // A dotted path → the hops it names, two segments at a time: a component
    // and one of its properties, or a component alone at the end, each named
    // by the name it is held under, a full label or an identity. A name no
    // component declares is refused, teaching the qualified forms where
    // properties of that name exist; only a presence test reads an undeclared
    // name as a component, since bundles can carry plugin components before
    // their schemas are loaded, and a store still decides whether it has a
    // table for it. A bare label several words share is refused with their
    // full labels. Every non-final hop must be a reference for the
    // dereference to stand.
    aim: aimer(
      () => v,
      (seg) => routes.has(seg) ? seg : plain.meant(seg)?.held,
      (comp, seg) => propOf(comp, seg),
      same,
    ),
    // A plural name → the reverse association it names, or undefined when the
    // name is no association (a caller then reads the name its own way).
    assoc: (name) => assocs.get(name),
    turn: (path) => {
      for (let i = 2; i < path.length; i += 2) {
        if (assocs.has(path[i])) return i
      }
      return -1
    },
    assocs: () => [...assocs],
    kind: (name) =>
      kindsBy.get(name) ??
        kindsBy.get(quiet(() => plainKinds.meant(name)?.held) ?? ''),
    // The most specific kind an entity is names it: the first in order whose
    // components it all carries, else the bare spine component.
    kindOf: (has) => {
      for (let i = 0; i < kinds.length; i++) {
        if (shapes[i].every((c) => has[c])) return kinds[i]
      }
      return 'entity'
    },
    // The cascading-delete worklist (@yaks/graph cascade.ts): every
    // client-writable reference that declares a `death`, as (comp, prop) pairs.
    // Stamped refs stay out — server-owned rows are deleted by server code,
    // never by a cascade a client set off (types.ts Death).
    deaths: (word) => {
      let got = dying.get(word)
      if (!got) {
        dying.set(
          word,
          got = compNames.flatMap((comp) =>
            infoOf(comp)!.writable.flatMap((p) => {
              let c = propFor(comp, p)!
              return c.category == 'ref' && c.death == word
                ? [[comp, p] as [string, string]]
                : []
            })
          ),
        )
      }
      return got
    },
    // Every reference property a stored component holds, client-writable or
    // stamped — index derivation and reverse-hop grammar key off this one
    // list.
    refProps: () => refs,
    // Ordinary well-formedness of an instance: a known component, an object of
    // known properties (client-writable unless stamped properties are allowed),
    // each value one the property can hold — a scalar, or for a `jsonb`
    // property a JSON value of a type it declares. The structure inside an
    // object or array (`properties`, `items`) is not validated yet.
    check: (comp, value, opts) => {
      let errs: string[] = []
      comp = look(comp) ?? comp
      let info = infoOf(comp)
      if (!info) return [unknownComps([comp])]
      if (value == null || typeof value != 'object' || Array.isArray(value)) {
        return [`${comp} is an object of properties`]
      }
      for (let [k, val] of Object.entries(value)) {
        let c = propFor(comp, k)
        if (!c || !opts?.stamped && (c.stamped || c.computed)) {
          errs.push(unknownProps(v, comp, [k]))
          continue
        }
        if (val == null) continue // a null clears the property
        if (c.scalar == 'binary') {
          if (!(val instanceof Uint8Array)) {
            errs.push(`${comp}.${k} holds bytes (Uint8Array)`)
          }
          continue
        }
        if (c.scalar == 'jsonb') {
          if (!holds(c.types!, val)) {
            errs.push(`${comp}.${k} is ${c.types!.map(a).join(' or ')}`)
          }
          continue
        }
        if (typeof val == 'object') {
          errs.push(
            `${comp}.${k} is a scalar, not ${
              Array.isArray(val) ? 'an array' : 'an object'
            }`,
          )
          continue
        }
        if (
          c.category == 'enum' && !c.values!.includes(String(val)) &&
          !(String(val) in (c.aliases ?? {}))
        ) {
          errs.push(`${comp}.${k} is one of ${c.values!.join(', ')}`)
        } else if (
          c.category == 'scalar' &&
          (c.scalar == 'number' || c.scalar == 'priority') &&
          (typeof val != 'number' || !Number.isFinite(val))
        ) {
          errs.push(`${comp}.${k} is a number`)
        } else if (
          c.category == 'scalar' && c.scalar == 'bool' &&
          typeof val != 'boolean' && val !== 0 && val !== 1
        ) {
          errs.push(`${comp}.${k} is a bool`)
        } else if (
          c.category == 'scalar' && c.scalar == 'json' && !jsonText(val)
        ) {
          errs.push(`${comp}.${k} is JSON text`)
        }
      }
      return errs
    },
  }

  // The vocabulary as each reader reads it, by who the reader is: this one
  // where it reads every name alike.
  let viewed = new Map<string, Vocab>()
  let viewOf = (ns?: Namespace, reader: Reader = {}): Vocab => {
    let key = JSON.stringify([
      ns?.id,
      ns?.label,
      reader.uses?.map((u) => [u.id, u.label]),
      reader.former,
    ])
    let got = viewed.get(key)
    if (!got) viewed.set(key, got = view(ns, reader))
    return got
  }
  let view = (ns: Namespace | undefined, reader: Reader): Vocab => {
    let comps = reading(compsNamed, ns, reader)
    let kinds_ = reading(kindsNamed, ns, reader)
    let compOut = new Map(compsNamed.map((w) => [w.held, comps.written(w)]))
    let kindOut = new Map(kindsNamed.map((w) => [w.held, kinds_.written(w)]))
    // The labels the reader's words were called before a rename that no
    // property of their component holds now, by component.
    let was = new Map<string, Map<string, string>>()
    for (let [id, labels] of Object.entries(reader.former ?? {})) {
      let w = words.get(id)
      if (!w || !('prop' in w) || !w.prop) continue
      let at = was.get(w.comp) ?? new Map<string, string>()
      for (let l of labels) {
        if (!routes.get(w.comp)!.includes(l)) at.set(l, w.prop)
      }
      was.set(w.comp, at)
    }
    let renamed = Object.keys(reader.former ?? {}).some((id) => words.has(id))
    let alike = (m: Map<string, string>) => [...m].every(([h, w]) => h == w)
    if (!renamed && alike(compOut) && alike(kindOut)) return v
    return relabeled(v, {
      comp: (h) => compOut.get(h) ?? h,
      kind: (h) => kindOut.get(h) ?? h,
      held: (name) => comps.meant(name)?.held,
      kindHeld: (name) => kinds_.meant(name)?.held,
      prop: (c, p) => propOf(c, p, was),
      aim: (self) =>
        aimer(
          self,
          (seg) => comps.meant(seg)?.held,
          (c, p) => propOf(c, p, was),
          (h) => compOut.get(h) ?? h,
        ),
    })
  }
  return v
}

// How a reader's names turn into a vocabulary's and back: `comp` and `kind`
// give the name the reader writes a held component or kind by, `held` and
// `kindHeld` the held name a reader's name means (throwing `Ambiguous`), and
// `prop` a held component's property by any name the reader writes.
type Turn = {
  comp: (held: string) => string
  kind: (held: string) => string
  held: (name: string) => string | undefined
  kindHeld: (name: string) => string | undefined
  prop: (comp: string, name: string) => string | undefined
  aim: (self: () => Vocab) => Vocab['aim']
}

// A vocabulary in a reader's names: every name it takes is turned into the
// held one before `v` is asked, and every name it gives is turned back.
let relabeled = (v: Vocab, t: Turn): Vocab => {
  let memo = <T>(f: (name: string) => T) => {
    let held = new Map<string, T>()
    return (name: string): T => {
      if (!held.has(name)) held.set(name, f(name))
      return held.get(name)!
    }
  }
  let quiet = (f: (name: string) => string | undefined) => (name: string) => {
    try {
      return f(name)
    } catch (e) {
      if (e instanceof Ambiguous) return undefined
      throw e
    }
  }
  let comp = memo(quiet(t.held))
  let kind = memo(quiet(t.kindHeld))
  let ref = (r?: string) => r && (v.kind(r) ? t.kind(r) : t.comp(r))
  let pair = ([c, p]: [string, string]): [string, string] => [t.comp(c), p]
  let info = memo((name): CompInfo | undefined => {
    let c = comp(name), got = c ? v.comp(c) : undefined
    return got && frozen({
      ...got,
      name: t.comp(got.name),
      before: got.before.map(t.kind),
      search: got.search.map((s) => {
        let [c, ...rest] = s.split('.')
        return [t.comp(c), ...rest].join('.')
      }),
      ...got.ladder
        ? {
          ladder: {
            ...got.ladder,
            rungs: got.ladder.rungs.map((r) => ({
              ...r,
              comp: t.comp(r.comp),
            })),
          },
        }
        : {},
    })
  })
  let kindInfo = memo((name): Kind | undefined => {
    let k = kind(name), got = k ? v.kind(k) : undefined
    return got && frozen({
      ...got,
      name: t.kind(got.name),
      is: got.is.map(t.comp),
      with: Object.fromEntries(
        Object.entries(got.with).map(([c, w]) => [t.comp(c), w]),
      ),
      before: got.before.map(t.kind),
    })
  })
  let props = new Map<string, Prop | undefined>()
  let self: Vocab = {
    ...v,
    comps: v.comps.map(t.comp).sort(),
    all: v.all.map(t.comp).sort(),
    kinds: v.kinds.map(t.kind),
    kind: kindInfo,
    comp: info,
    held: (name) => {
      let h = t.held(name)
      return h && t.comp(h)
    },
    word: (id) => {
      let w = v.word(id)
      return !w ? w : 'kind' in w ? { kind: t.kind(w.kind) } : {
        ...w,
        comp: t.comp(w.comp),
      }
    },
    def: (name) => v.def(comp(name) ?? ''),
    props: (name) => v.props(comp(name) ?? ''),
    prop: (name, p) => {
      let key = `${name}.${p}`
      if (props.has(key)) return props.get(key)
      let c = comp(name), q = c && t.prop(c, p)
      let got = q ? v.prop(c!, q) : undefined
      let out = got &&
        frozen({ ...got, comp: t.comp(got.comp), ref: ref(got.ref) })
      props.set(key, out)
      return out
    },
    indexes: (name) => v.indexes(comp(name) ?? ''),
    identity: (name) => v.identity(comp(name) ?? ''),
    aim: t.aim(() => self),
    assoc: (name) => {
      let a = v.assoc(name)
      return a && { ...a, comp: t.comp(a.comp) }
    },
    assocs: () =>
      v.assocs().map(([n, a]) => [n, { ...a, comp: t.comp(a.comp) }]),
    kindOf: (has) => {
      let held: Record<string, unknown> = {}
      for (let k in has) held[comp(k) ?? k] = has[k]
      return t.kind(v.kindOf(held))
    },
    deaths: (word) => v.deaths(word).map(pair),
    refProps: () => v.refProps().map(pair),
    check: (name, value, opts) => v.check(comp(name) ?? name, value, opts),
  }
  return self
}

let frozen = <T>(x: T): T => {
  if (x && typeof x == 'object') {
    for (let v of Object.values(x)) frozen(v)
    Object.freeze(x)
  }
  return x
}
