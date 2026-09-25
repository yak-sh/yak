// The types @yaks/vocab returns. A vocabulary is authored as JSON Schema
// (2020-12) plus the yaks keywords; this module names the parts a loaded
// document is read back as, so a downstream storage binder (@yaks/sql) never
// reads a raw schema — it reads a `Prop`, a `Hop`, a `Kind`.
//
// Nothing here is application-specific: `Death`, `Scalar`, and the keyword
// names describe the format, and any set of components is one instance of it.

import type { Sync } from './lifetime.ts'

// What the cascading delete (@yaks/graph cascade.ts) does to a reference
// property when its target entity is deleted. These four values are the whole
// set — a reference that declares none is rejected, so an undeclared behavior
// cannot exist.
//   cascade  the referencing entity is deleted with the target
//   detach   the property is set null and clients are told about it
//   release  the row is deleted but its entity lives (a tag whose existence IS
//            the reference)
//   keep     the reference stands as history (no FK; the tombstone is the mark)
export type Death = 'cascade' | 'detach' | 'release' | 'keep'

// The scalar type names a property reconstructs to — a compact type set
// recovered from native JSON Schema (`type` + `format`):
//   text   string, no format          number  number
//   time   string, format:date-time   priority number, format:priority
//   url    string, format:uri         bool    boolean
//   query  string, format:query       json    string, format:json
//   jsonb  object, array, or a union of types: a JSON value, kept as one
//
// `json` is JSON text in a string; `jsonb` is the value itself, written and
// read back as JSON and stored in SQLite's binary JSON.
//
// Where a string property keeps its value is a separate question, and not this
// format's: @yaks/blob owns the `store` keyword and answers it.
export type Scalar =
  | 'text'
  | 'number'
  | 'priority'
  | 'bool'
  | 'query'
  | 'json'
  | 'jsonb'
  | 'time'
  | 'url'

// One property, read back. `category` is the coarse kind a storage binder
// switches on; `scalar` refines a scalar property to its type name;
// `values`/`ref` carry the closed set or the referenced entity kind. `affinity`
// and `fk` are the two answers a SQLite lowering needs and nothing else has to
// recompute.
export type Prop = {
  comp: string
  prop: string
  /** what the property means, as its schema describes it — the text a schema
   * listing hands an agent, so a property is not read off its name alone */
  description?: string
  category: 'scalar' | 'enum' | 'ref'
  scalar?: Scalar
  values?: string[] // enum members
  /** the JSON types a `jsonb` property holds, as declared (`['object']`,
   * `['string', 'array']`) */
  types?: string[]
  aliases?: Record<string, string> // input forms → a member
  ref?: string // the entity kind a reference names ('entity' = any)
  death?: Death
  stamped: boolean // the server owns it: clients read it, never write it
  /** this text property is full-text indexed, so a bare word in a query
   * matches it (@yaks/fts builds the index). A property nobody declares is
   * never searched. */
  search: boolean
  /** derived, never stored: no column holds it and nobody writes it, but a
   * reader still sees it (a query-only rank, an aggregate, a derived status) */
  computed: boolean
  /** on a computed property, the components on other entities its value is
   * read from (`[]` for its own entity alone); absent, it may read anything */
  reads?: string[]
  /** this property is what the entity's own id is derived from — see the
   * `identity` keyword and `Vocab.identity` */
  identity: boolean
  affinity: 'text' | 'real' | 'integer' | 'blob' // the SQLite column affinity it stores as
  fk: boolean // a reference carrying a foreign key to entity(id)
  /** the component's `required` list names it: a row may not hold it null */
  required: boolean
  /** what a row holds when the writer supplied nothing — see {@link Default} */
  default?: Default
  keywords: Record<string, unknown> // registered extension keywords, verbatim
}

// A property's default, from native `default`: a literal the row takes, or the
// clock — `{"now": true}` is the one value JSON has no literal for, so it is
// written as an object no scalar property could hold and never mistaken for
// one.
export type Default = { now: true } | { value: string | number | boolean }

// A component, read back: its properties split writable/stamped, its display
// facts, and whatever extension keywords a caller registered (keywords.ts) —
// copied verbatim, never interpreted here.
export type CompInfo = {
  name: string
  description?: string // what the component means, as its schema describes it
  wire: boolean // false = a component clients read but cannot write
  kind: boolean // this comp names a display kind
  package?: string // the package whose document declared it, where one says
  before: string[] // kinds this kind sorts before (feeds kindOrder)
  writable: string[] // property names a client may write
  stamped: string[] // property names only the server writes
  /** who is told about a write to it — see {@link Sync} */
  sync: Sync
  /** how long one of its values lives: `forever`, `connection`, or a duration
   * (lifetime.ts `ms` reads the span out of one) */
  durable: string
  keywords: Record<string, unknown> // registered extension keywords, verbatim
}

// The properties an entity's own id is derived from, in the order the
// derivation reads them. Empty for the ordinary component, whose entities take
// a minted id.
export type Identity = string[]

// One index over a component's table: the properties it covers, in order, and
// whether it also promises uniqueness. Derived from the `unique`/`index`
// keywords (a property's own flag, plus the component's composite lists),
// identity, and automatic reference indexes — see `Vocab.indexes`. A partial
// index names the properties a row must hold for the index to see it
// (`present`): a unique over an optional key, where absent rows may be many and
// present ones one.
export type Index = { props: string[]; unique: boolean; present?: string[] }

// One entry of a component's composite `unique`/`index` list: the property
// names alone, or an object that also names which properties must be present.
export type Composite = string[] | { props: string[]; present?: string[] }

// One deref step of a dotted path: the component a segment landed in and the
// property it named. `.comment.target.doc.title` →
// [{comment,target},{doc,title}].
export type Hop = { comp: string; prop: string }

// A reverse association: one component's reference property, seen from the far
// side. `.reviews` on a book is the `review` rows whose `book` property points
// at it, so the association is that (comp, prop) pair under a plural name.
export type Assoc = { comp: string; prop: string }

// Which components an entity has, with no property value: all of these present,
// none of those. Both the storage binder (@yaks/sql) and the table-set cache
// (@yaks/archetype) take this type, so it lives under neither of them.
export type Presence = { all?: readonly string[]; none?: readonly string[] }

// A vocabulary document, as authored: a JSON Schema whose `$defs` are the
// components. Loose on purpose — the meta-schema and loadVocab() are what
// validate it; this is just enough shape for the reader.
export type VocabDoc = {
  $id?: string
  $vocabulary?: Record<string, boolean>
  title?: string
  /** the package that declares these components — written by the host that
   * loads the document (@yaks/cli `compose`), so a reader can say where each
   * component comes from */
  package?: string
  $defs?: Record<string, PropSchema>
  [k: string]: unknown
}

// One component's schema (a `$defs` entry): an object schema whose `properties`
// are its properties, plus the yaks comp-level keywords.
export type PropSchema = {
  // One JSON type, or a union of them. Every property declares one.
  type?: string | string[]
  properties?: Record<string, PropSchema>
  // The shape of an array property's elements. Declared, not yet validated.
  items?: unknown
  // What a $defs entry IS. An entry carries one of these markers or it is an
  // ordinary reusable subschema — the loader creates neither a table nor a
  // tool for it.
  component?: boolean
  tool?: boolean
  rule?: boolean
  // true = this component entry adds properties to a component another document
  // declares, rather than declaring one of its own (vocab.ts `extended`).
  extends?: boolean
  // A rule declaration's own keywords: the query it matches, and the phase it
  // runs in (`rules` by default; `effect` is a rule a post-commit runner asks
  // for). `before` is shared with a kind's ordering and means the same thing —
  // what this runs before.
  match?: string
  phase?: string
  // A tool declaration's own keywords: what it is called, and its arguments.
  noun?: string
  verb?: string
  input?: Record<string, PropSchema>
  // native
  format?: string
  enum?: readonly string[]
  const?: unknown
  default?: unknown
  description?: string
  examples?: readonly unknown[]
  $ref?: string
  // yaks core keywords (death is loose here — a JSON import infers plain
  // string; the storable check is what rejects a value outside the four)
  ref?: string
  death?: string
  // true = derived, never stored (on a property)
  computed?: boolean
  // On a computed property: the components on other entities it reads.
  reads?: string[]
  stamped?: boolean
  // On a component: who is told about a write, and how long the value lives
  // (lifetime.ts).
  sync?: string
  durable?: string
  // true = this text property is full-text indexed (@yaks/fts reads it).
  search?: boolean
  kind?: boolean
  before?: string[]
  // On a component reported out of a vocabulary of several packages: the one
  // that declared it (@yaks/graph `schemaOf`). A document says it once instead.
  package?: string
  wire?: boolean
  bare?: boolean
  // On a property a boolean (this property alone); on a component the composite
  // property lists. `Vocab.indexes` merges the two forms. Stored references are
  // always indexed: index: true is redundant and false does not opt out.
  unique?: boolean | Composite[]
  index?: boolean | Composite[]
  // native: the properties a row must hold (NOT NULL), on the component
  required?: string[]
  // What the entity's id is derived from. On a property, true; on a component,
  // the property list a composite identity is written across. One tuple, not a
  // list of them: an entity has one id. `Vocab.identity` merges the two forms.
  identity?: boolean | string[]
  aliases?: Record<string, string>
  // an extension vocabulary's keywords are carried here too (keywords.ts)
  [k: string]: unknown
}
