// The shapes @yaks/vocab speaks. A vocab is authored as JSON Schema (2020-12)
// plus the yaks keyword vocabulary; this module names the parts a loaded
// instance answers with, so a downstream binder (@yaks/sql) never reads a raw
// schema — it reads a `Column`, a `Hop`, a `Kind`.
//
// Nothing here is application-specific: `Death`, `Scalar`, and the keyword
// names are the meta-model, and any set of components is one instance of it.

import type { Sync } from './lifetime.ts'

// What the reaper does to a reference column when its TARGET entity dies. The
// four words are the whole vocabulary — a reference without one is refused, so
// an undeclared behavior cannot exist.
//   cascade  the referencing entity dies with the target
//   detach   the column is set null and the wire hears it
//   release  the ROW dies but its entity lives (a tag whose existence IS the ref)
//   keep     the reference stands as history (no FK; the tombstone is the mark)
export type Death = 'cascade' | 'detach' | 'release' | 'keep'

// The scalar spellings a column reconstructs to — a compact type vocabulary
// recovered from native JSON Schema (`type` + `format`):
//   text   string, no format          number  number
//   time   string, format:date-time   priority number, format:priority
//   url    string, format:uri         bool    boolean
//   query  string, format:query       json    string, format:json
//
// Where a string column KEEPS its value is a separate question, and not this
// meta-model's: @yaks/blob owns the `store` keyword and answers it.
export type Scalar =
  | 'text'
  | 'number'
  | 'priority'
  | 'bool'
  | 'query'
  | 'json'
  | 'time'
  | 'url'

// One column, interrogated. `kind` is the coarse category a binder switches on;
// `scalar` refines a scalar column to its type spelling; `values`/`ref` carry
// the closed set or the pointed-at entity kind. `affinity` and `fk` are the two
// answers a SQLite lowering needs and nothing else has to recompute.
export type Column = {
  comp: string
  prop: string
  /** what the column MEANS, as its schema says it — the sentence a schema
   * door hands an agent so a column is not read off its name alone */
  description?: string
  category: 'scalar' | 'enum' | 'ref'
  scalar?: Scalar
  values?: string[] // enum members
  aliases?: Record<string, string> // input spellings → a member
  ref?: string // the entity kind a reference names ('entity' = any)
  death?: Death
  stamped: boolean // server-owned: readable, never wire-writable
  /** this text column's words are indexed: a bare-word search matches them
   * (@yaks/fts reads it). A column nobody declares is never searched. */
  search: boolean
  /** derived, never stored: no column holds it and nobody writes it, but a
   * reader still sees it (a query-only rank, an aggregate, a derived status) */
  computed: boolean
  /** this column is what the entity's own id is derived from — see the
   * `identity` keyword and `Vocab.identity` */
  identity: boolean
  affinity: 'text' | 'real' | 'integer' // the SQLite column affinity it stores as
  fk: boolean // a reference carrying a foreign key to entity(id)
  /** the component's `required` list names it: a row may not hold it null */
  required: boolean
  /** what a row holds when the writer said nothing — see {@link Default} */
  default?: Default
  keywords: Record<string, unknown> // registered extension keywords, verbatim
}

// A column's default, from native `default`: a literal the row takes, or the
// clock — `{"now": true}` is the one spelling JSON has no literal for, so it is
// an object no scalar column could hold and never mistaken for a value.
export type Default = { now: true } | { value: string | number | boolean }

// A component, interrogated: its columns split writable/stamped, its display
// facts, and whatever extension keywords a caller registered (keywords.ts) —
// carried verbatim, never interpreted here.
export type CompInfo = {
  name: string
  description?: string // what the component means, as its schema says it
  wire: boolean // false = readable-not-writable component (the spine)
  kind: boolean // this comp names a display kind
  before: string[] // kinds this kind sorts before (feeds kindOrder)
  writable: string[] // wire-writable column names
  stamped: string[] // server-owned column names
  /** who hears about a write to it — see {@link Sync} */
  sync: Sync
  /** how long one of its values lives: `forever`, `connection`, or a duration
   * (lifetime.ts `ms` reads the span out of one) */
  durable: string
  keywords: Record<string, unknown> // registered extension keywords, verbatim
}

// The columns an entity's own id is derived from, in the order the derivation
// says them. Empty for the ordinary component, whose entities take a minted id.
export type Identity = string[]

// One index over a component's table: the columns it covers, in order, and
// whether it also promises uniqueness. Derived from the `unique`/`index`
// keywords (a column's own flag, plus the component's composite lists), identity,
// and automatic reference indexes — see `Vocab.indexes`. A PARTIAL index names
// the columns a row must hold for the index to see it (`present`): a unique
// over an optional key, where absent rows may be many and present ones one.
export type Index = { cols: string[]; unique: boolean; present?: string[] }

// One entry of a component's composite `unique`/`index` list: the column names
// alone, or an object that also says which columns must be present.
export type Composite = string[] | { cols: string[]; present?: string[] }

// One deref step of a dotted path: the component a segment landed in and the
// column it named. `.comment.target.doc.title` → [{comment,target},{doc,title}].
export type Hop = { comp: string; prop: string }

// A reverse ASSOCIATION: one component's reference column, seen from the far
// side. `.reviews` on a book is the `review` rows whose `book` column points at
// it, so the association is that (comp, prop) pair under a plural name.
export type Assoc = { comp: string; prop: string }

// Which components an entity WEARS, and no column value: all of these present,
// none of those. The word both a binder (@yaks/sql) and a table-set cache
// (@yaks/archetype) speak, so it lives under neither of them.
export type Presence = { all?: readonly string[]; none?: readonly string[] }

// A vocab document, as authored: a JSON Schema whose `$defs` are the components.
// Loose on purpose — the meta-schema and loadVocab() are what validate it; this
// is just enough shape for the reader.
export type VocabDoc = {
  $id?: string
  $vocabulary?: Record<string, boolean>
  title?: string
  $defs?: Record<string, PropSchema>
  [k: string]: unknown
}

// One component's schema (a `$defs` entry): an object schema whose `properties`
// are the columns, plus the yaks comp-level keywords.
export type PropSchema = {
  type?: string
  properties?: Record<string, PropSchema>
  // native
  format?: string
  enum?: readonly string[]
  const?: unknown
  default?: unknown
  description?: string
  examples?: readonly unknown[]
  $ref?: string
  // yaks core keywords (death is loose here — a JSON import infers plain
  // string; the storable check is what refuses a word outside the four)
  ref?: string
  death?: string
  // true = derived, never stored (on a COLUMN)
  computed?: boolean
  stamped?: boolean
  // On a COMPONENT: who hears about a write, and how long the value lives
  // (lifetime.ts).
  sync?: string
  durable?: string
  // true = this text column is full-text indexed (@yaks/fts reads it).
  search?: boolean
  kind?: boolean
  before?: string[]
  wire?: boolean
  bare?: boolean
  // On a COLUMN a boolean (this column alone); on a COMPONENT the composite
  // column lists. `Vocab.indexes` merges the two spellings. Stored references
  // are always indexed: index: true is redundant and false does not opt out.
  unique?: boolean | Composite[]
  index?: boolean | Composite[]
  // native: the columns a row must hold (NOT NULL), on the COMPONENT
  required?: string[]
  // What the entity's id is DERIVED from. On a COLUMN, true; on a COMPONENT,
  // the column list a composite identity is spelled across. One tuple, not a
  // list of them: an entity has one id. `Vocab.identity` merges the spellings.
  identity?: boolean | string[]
  aliases?: Record<string, string>
  // an extension vocabulary's keywords ride here too (keywords.ts)
  [k: string]: unknown
}
