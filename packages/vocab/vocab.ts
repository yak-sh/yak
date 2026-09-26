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
  Prop,
  PropSchema,
  Scalar,
  VocabDoc,
} from './types.ts'
import type { Keywords } from './keywords.ts'
import { kept, paced, said, type Sync } from './lifetime.ts'
import { kindOrder as deriveKindOrder } from './order.ts'

/** A name this vocabulary does not know. One error for every caller, raised
 * here because the vocabulary is what decides: `route()` raises it when
 * nothing claims the bare name, `aim()` when a component is named with a
 * property it does not declare (saying which ones it does), and the storage
 * binder (@yaks/sql) when a presence test names a component it has no table
 * for. `prop` is the name, unadorned. */
export class Unknown extends Error {
  prop: string
  constructor(prop: string, message = `unknown prop: .${prop}`) {
    super(message)
    this.prop = prop
    this.name = 'Unknown'
  }
}

/** A bare name several components declare. The vocabulary alone cannot decide
 * which is meant, so it reports which ones, and a caller that holds more than
 * the one name picks between them (@yaks/graph's `meaning`, which reads the
 * component off the rest of the query). Unresolved, it reaches the caller as
 * this error: the name, the candidates, and a qualified name to use
 * instead. */
export class Ambiguous extends Error {
  prop: string
  comps: string[]
  constructor(prop: string, comps: string[]) {
    super(
      `.${prop} is ambiguous (${comps.join(', ')}) — use .${comps[0]}.${prop}`,
    )
    this.prop = prop
    this.comps = comps
    this.name = 'Ambiguous'
  }
}

// The keywords an extension entry may carry. Everything else about a component
// — its kind, its prefix, its indexes, whether it reaches the wire — belongs to
// the document that declares it, so an extension that states one of those is a
// mistake rather than an override.
let ADDABLE = ['component', 'extends', 'type', 'description', 'properties']

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
  return { ...base, properties, ...need.length ? { required: need } : {} }
}

// A component's `search` list: the text its entities are found by, read off
// another component — `entry` names `content.body`, so a transcript entry is
// found by what it says, while the tool results and process output that also
// carry `content` are not. It is checked once every document is read, because
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
export let jsonb = (s: PropSchema): boolean =>
  Array.isArray(s.type) || s.type == 'object' || s.type == 'array'

// Every property says what it holds. A property with no `type` is refused
// rather than read as text: the schema is what a reader expects back, and a
// guess is not a promise.
export let TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array']
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
  scalar == 'jsonb'
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
  return {
    comp,
    prop,
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

// The query surface. Every method answers over the loaded documents; none
// reads a global.
export type Vocab = {
  docs: VocabDoc[]
  keywords: Keywords[] // the extension vocabularies this load registered
  comps: string[] // component names a client may write, alphabetical
  all: string[] // every declared component name, alphabetical
  kinds: string[] // kindOrder: alphabetical, refined by `before`, topo-sorted
  comp: (name: string) => CompInfo | undefined
  /** A component's `$defs` entry as its documents declare it, with every
   * `extends` applied — the JSON Schema itself, for a reader that wants the
   * schema rather than the facts this load read out of it. */
  def: (name: string) => PropSchema | undefined
  props: (comp: string) => string[] // readable properties (writable ∪ stamped)
  prop: (comp: string, prop: string) => Prop | undefined
  /** Declared indexes plus automatic reference indexes — see
   * {@link Index}. A storage adapter renders them; nothing else reads them. */
  indexes: (comp: string) => Index[]
  /** The properties this component's entities are identified by — the tuple the
   * id is derived from, in derivation order, or `[]` for the ordinary
   * component whose entities take a minted id. @yaks/graph does the
   * derivation. */
  identity: (comp: string) => Identity
  route: (prop: string) => { comp: string; prop: string }
  /** A dotted path → the hops it names. Pass `facet` when the predicate is the
   * bare presence test (`.name`): a single segment naming a component is then
   * a test for that component, even if a property of the same name would
   * otherwise claim the bare name. A name no property claims is read as a
   * component too, since a presence test needs no property schema. */
  aim: (path: string, facet?: boolean) => Hop[]
  assoc: (name: string) => Assoc | undefined
  kindOf: (has: Record<string, unknown>) => string
  deaths: (word: Death) => [string, string][]
  refProps: () => [string, string][]
  check: (
    comp: string,
    value: Record<string, unknown>,
    opts?: { stamped?: boolean },
  ) => string[]
}

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
// (`.eid=`, `.entity.eid=`) rather than making each vocabulary re-declare it.
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
  let props = v.props(comp)
  if (!props.length) return `${comp} has no properties`
  let said = props.map((p) => `${p} (${declared(v.prop(comp, p)!)})`)
  return `${comp} has ${said.join(', ')}`
}

/** The refusal for properties a component does not declare: one wording,
 * whether a query or a write named them. */
export let unknownProps = (v: Vocab, comp: string, props: string[]): string =>
  `unknown ${props.length > 1 ? 'properties' : 'property'}: ${
    props.map((p) => `${comp}.${p}`).join(', ')
  } — ${shapeOf(v, comp)}`

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

/** How often a relayed value of a component is sent, in milliseconds — `null`
 * for a component that declares no pace, or that this vocabulary does not
 * declare, and every write is sent as it is made. */
export let paceOf = (v: Vocab, comp: string): number | null =>
  v.comp(comp)?.pace ?? null

export let loadVocab = (
  input: VocabDoc | VocabDoc[],
  keywords: Keywords[] = [],
): Vocab => {
  let docs = Array.isArray(input) ? input : [input]
  let compWords = new Set(keywords.flatMap((k) => k.comp ?? []))
  let propWords = new Set(keywords.flatMap((k) => k.prop ?? []))
  // Merge every document's component entries into one table; a name declared
  // twice is a conflict (one name, one home). `$defs` is JSON Schema's own
  // reuse slot, so an entry carries a marker saying what it is:
  // `component: true` is a component, `tool: true` is a tool declaration
  // (tools.ts `toolsIn` reads those), `rule: true` is a rule (rules.ts
  // `rulesIn`) and `effect: true` is an effect (effects.ts `effectsIn`), all of
  // which this loader skips, and anything else is an ordinary subschema
  // somebody `$ref`s. An entry with properties and no
  // marker is the one case that throws rather than being skipped: it is a
  // component whose marker was forgotten, and creating no table for it would
  // silently lose the component.
  //
  // `extends: true` is the one entry that may name a component another document
  // already declared: it adds properties to it (`extended`). Those are applied
  // after every document is read, so the order the documents were loaded in
  // decides nothing.
  let defs: Record<string, PropSchema> = {}
  let from: Record<string, string> = {} // a component → the package declaring it
  let adding: [string, PropSchema][] = []
  for (let doc of docs) {
    for (let [name, schema] of Object.entries(doc.$defs ?? {})) {
      if (
        schema?.tool === true || schema?.rule === true ||
        schema?.effect === true
      ) continue
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
      if (name in defs) throw new Error(`component '${name}' is declared twice`)
      defs[name] = schema
      let pkg = schema.package ?? doc.package
      if (pkg) from[name] = pkg
    }
  }
  for (let [name, schema] of adding) {
    defs[name] = extended(name, defs[name], schema)
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
  let read = new Map<string, Map<string, Prop>>()
  for (let comp of names) {
    let d = defs[comp]
    read.set(
      comp,
      new Map(
        Object.entries(props(comp)).map(([prop, s]) => [
          prop,
          propOf(comp, prop, s, propWords, !!d.required?.includes(prop)),
        ]),
      ),
    )
  }
  let propFor = (comp: string, prop: string): Prop | undefined =>
    read.get(comp)?.get(prop)

  let wire = (name: string) => defs[name].wire !== false
  let compNames = names.filter(wire)

  let info = (name: string): CompInfo => {
    let d = defs[name]
    let entries = Object.keys(props(name))
    return {
      name,
      description: d.description,
      wire: d.wire !== false,
      kind: !!d.kind,
      ...(from[name] ? { package: from[name] } : {}),
      before: d.before ?? [],
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
      search: lists[name],
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

  // Reverse index: a bare prop to the components that declare it. A property
  // (or whole component) marked `bare: false` never claims a bare name — it is
  // reached qualified only — so it stays out of this index entirely.
  let owners = new Map<string, string[]>()
  for (let [comp, ps] of routes) {
    if (defs[comp].bare === false) continue
    for (let p of ps) {
      if (props(comp)[p].bare === false) continue
      owners.set(p, [...(owners.get(p) ?? []), comp])
    }
  }

  // A plural that is a name, not English: uniqueness is the goal, so 'shelf' →
  // 'shelfs' is fine and 'series' → 'series' stays put.
  let plural = (s: string) =>
    s.endsWith('y') ? `${s.slice(0, -1)}ies` : s.endsWith('s') ? s : `${s}s`

  // The reverse associations, derived from the reference properties and never
  // hand listed, so a new reference property earns its reverse name for free. A
  // component with one reference is named by its plural (`review.book` →
  // `.reviews`); several references disambiguate with the property
  // (`loan.book`, `loan.member` → `.loans_book`, `.loans_member`). A name a
  // property or component already routes is left alone — the forward name
  // always wins — and where two components pluralize alike the alphabetically
  // first keeps it.
  let assocs = new Map<string, Assoc>()
  for (let comp of names) {
    let refs = Object.keys(props(comp))
      .filter((p) => propFor(comp, p)!.category == 'ref')
    for (let prop of refs) {
      let name = refs.length == 1 ? plural(comp) : `${plural(comp)}_${prop}`
      if (owners.has(name) || routes.has(name) || assocs.has(name)) continue
      assocs.set(name, { comp, prop })
    }
  }

  let refs = names.flatMap((comp) =>
    [...read.get(comp)!.values()].flatMap((c) =>
      c.category == 'ref' ? [[comp, c.prop] as [string, string]] : []
    )
  )
  let dying = new Map<string, [string, string][]>()

  let kinds = deriveKindOrder(
    names.filter((n) => defs[n].kind),
    (k) => defs[k].before ?? [],
  )

  let v: Vocab = {
    docs,
    keywords,
    comps: compNames,
    all: names,
    kinds,
    comp: infoOf,
    def: (name) => defs[name],
    props: (comp) => routes.get(comp) ?? [],
    prop: propFor,
    indexes: (comp) => indexesOf(defs[comp], (p) => propFor(comp, p)),
    identity: (comp) => identityOf(defs[comp]),
    // Bare prop → its owning component. A stamped lifecycle property never
    // takes a bare name from a writable one (`.status` stays the task's even
    // though sessions carry a stamped status), so non-stamped owners are
    // preferred first. A single owner wins; several owners that are all
    // references mean one thing to a reader (comp '' — the filter scans every
    // owner); any other collision throws {@link Ambiguous}, which names the
    // candidates so a caller holding the rest of the query can pick among them.
    // A bare name that is itself a component name routes as a presence test for
    // that component.
    route: (prop) => {
      let own = owners.get(prop) ?? []
      if (own.length > 1) {
        let live = own.filter((c) => !propFor(c, prop)!.stamped)
        if (live.length) own = live
      }
      if (own.length == 1) return { comp: own[0], prop }
      if (own.length > 1) {
        if (own.every((c) => propFor(c, prop)?.category == 'ref')) {
          return { comp: '', prop }
        }
        throw new Ambiguous(prop, own)
      }
      if (routes.has(prop)) return { comp: prop, prop: '' }
      if (prop == EID) return { comp: SPINE, prop: EID }
      throw new Unknown(prop)
    },
    // A dotted path → the hops it names, one rule per step: a segment naming a
    // component with another segment after it is the explicit `comp.prop`
    // form and consumes two segments; anything else is a bare prop routed by
    // name and consumes one. Every non-final hop must be a reference for the
    // dereference to stand.
    //
    // `facet` is the one exception, and it belongs to the presence test alone
    // (`.name`): a name alone tests for a component, so the component wins
    // over a property of the same name. It has to — a presence test has no
    // other form, while the property keeps its qualified one
    // (`.camera.canvas`).
    // Without it, `.canvas` would test camera's canvas reference and return
    // the wrong entities, or none. A name no property claims is read as a
    // component too: bundles can carry plugin components before their schemas
    // are loaded. A store still decides whether it has a table for that
    // component.
    aim: (path, facet) => {
      let segs = path.split('.')
      if (facet && segs.length == 1) {
        let name = segs[0]
        let owned = owners.has(name) || name == EID
        if (routes.has(name) || !owned) return [{ comp: name, prop: '' }]
      }
      let out: Hop[] = []
      for (let i = 0; i < segs.length;) {
        let own = routes.get(segs[i])
        if (own && i + 1 < segs.length) {
          let [a, b] = [segs[i], segs[i + 1]]
          if (!own.includes(b) && !(a == SPINE && b == EID)) {
            throw new Unknown(`${a}.${b}`, unknownProps(v, a, [b]))
          }
          out.push({ comp: a, prop: b })
          i += 2
        } else {
          out.push(v.route(segs[i]))
          i += 1
        }
      }
      return out
    },
    // A plural name → the reverse association it names, or undefined when the
    // name is no association (a caller then reads the name its own way).
    assoc: (name) => assocs.get(name),
    // The most specific kind an entity carries names it — first present in
    // kindOrder, else the bare spine component.
    kindOf: (has) => kinds.find((k) => has[k]) ?? 'entity',
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
    // Every reference property, client-writable or stamped — index derivation
    // and reverse-hop grammar key off this one list.
    refProps: () => refs,
    // Ordinary well-formedness of an instance: a known component, an object of
    // known properties (client-writable unless stamped properties are allowed),
    // each value one the property can hold — a scalar, or for a `jsonb`
    // property a JSON value of a type it declares. The structure inside an
    // object or array (`properties`, `items`) is not validated yet.
    check: (comp, value, opts) => {
      let errs: string[] = []
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
  return v
}
