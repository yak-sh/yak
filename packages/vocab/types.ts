// The shapes @yaks/vocab speaks. A vocab is authored as JSON Schema (2020-12)
// plus the yaks keyword vocabulary; this module names the parts a loaded
// instance answers with, so a downstream binder (@yaks/sql) never reads a raw
// schema — it reads a `Column`, a `Hop`, a `Kind`.
//
// Nothing here is application-specific: `Death`, `Scalar`, and the keyword
// names are the meta-model, and any set of components is one instance of it.

// What the reaper does to a reference column when its TARGET entity dies. The
// four words are the whole vocabulary — a reference without one is refused, so
// an undeclared behavior cannot exist.
//   cascade  the referencing entity dies with the target
//   detach   the column is set null and the wire hears it
//   release  the ROW dies but its entity lives (a tag whose existence IS the ref)
//   keep     the reference stands as history (no FK; the tombstone is the mark)
export type Death = 'cascade' | 'detach' | 'release' | 'keep'

// The scalar spellings a column reconstructs to — a compact type vocabulary
// recovered from native JSON Schema (`type` + `format` + `store`):
//   text   string, no format          number  number
//   body   string, store:blob         priority number, format:priority
//   time   string, format:date-time   bool    boolean
//   url    string, format:uri
//   query  string, format:query
export type Scalar =
  | 'text'
  | 'body'
  | 'number'
  | 'priority'
  | 'bool'
  | 'query'
  | 'time'
  | 'url'

// One column, interrogated. `kind` is the coarse category a binder switches on;
// `scalar` refines a scalar column to its type spelling; `values`/`ref` carry
// the closed set or the pointed-at entity kind. `affinity` and `fk` are the two
// answers a SQLite lowering needs and nothing else has to recompute.
export type Column = {
  comp: string
  prop: string
  category: 'scalar' | 'enum' | 'ref'
  scalar?: Scalar
  values?: string[] // enum members
  aliases?: Record<string, string> // input spellings → a member
  ref?: string // the entity kind a reference names ('entity' = any)
  death?: Death
  stamped: boolean // server-owned: readable, never wire-writable
  persist: boolean // false = computed/never-stored (query-only rank, aggregates)
  store?: 'blob' // a body column, backed by a content-addressed blob
  affinity: 'text' | 'real' | 'integer' // the SQLite column affinity it stores as
  fk: boolean // a reference carrying a foreign key to entity(id)
}

// A component, interrogated: its columns split writable/stamped, its display
// facts, and two comp keywords the loader records but does not act on — an id
// `prefix` and whether its title is a name a caller can resolve.
export type CompInfo = {
  name: string
  wire: boolean // false = readable-not-writable component (the spine)
  kind: boolean // this comp names a display kind
  before: string[] // kinds this kind sorts before (feeds kindOrder)
  writable: string[] // wire-writable column names
  stamped: string[] // server-owned column names
  prefix?: string // a human id prefix (T, P, …) — carried, behavior deferred
  byName?: boolean // the title is a typeable name — carried, behavior deferred
}

// One deref step of a dotted path: the component a segment landed in and the
// column it named. `.comment.target.doc.title` → [{comment,target},{doc,title}].
export type Hop = { comp: string; prop: string }

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
  persist?: boolean
  stamped?: boolean
  store?: string
  kind?: boolean
  before?: string[]
  wire?: boolean
  bare?: boolean
  aliases?: Record<string, string>
  // comp keywords the loader records but does not act on
  prefix?: string
  by_name?: boolean
  [k: string]: unknown
}
