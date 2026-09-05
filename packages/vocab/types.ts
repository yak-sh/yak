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
// recovered from native JSON Schema (`type` + `format`):
//   text   string, no format          number  number
//   time   string, format:date-time   priority number, format:priority
//   url    string, format:uri         bool    boolean
//   query  string, format:query
//
// Where a string column KEEPS its value is a separate question, and not this
// meta-model's: @yaks/blob owns the `store` keyword and answers it.
export type Scalar =
  | 'text'
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
  affinity: 'text' | 'real' | 'integer' // the SQLite column affinity it stores as
  fk: boolean // a reference carrying a foreign key to entity(id)
  keywords: Record<string, unknown> // registered extension keywords, verbatim
}

// A component, interrogated: its columns split writable/stamped, its display
// facts, and whatever extension keywords a caller registered (keywords.ts) —
// carried verbatim, never interpreted here.
export type CompInfo = {
  name: string
  wire: boolean // false = readable-not-writable component (the spine)
  kind: boolean // this comp names a display kind
  before: string[] // kinds this kind sorts before (feeds kindOrder)
  writable: string[] // wire-writable column names
  stamped: string[] // server-owned column names
  keywords: Record<string, unknown> // registered extension keywords, verbatim
}

// One index over a component's table: the columns it covers, in order, and
// whether it also promises uniqueness. Derived from the `unique`/`index`
// keywords (a column's own flag, plus the component's composite lists), never
// hand-listed — see `Vocab.indexes`.
export type Index = { cols: string[]; unique: boolean }

// One deref step of a dotted path: the component a segment landed in and the
// column it named. `.comment.target.doc.title` → [{comment,target},{doc,title}].
export type Hop = { comp: string; prop: string }

// A reverse ASSOCIATION: one component's reference column, seen from the far
// side. `.reviews` on a book is the `review` rows whose `book` column points at
// it, so the association is that (comp, prop) pair under a plural name.
export type Assoc = { comp: string; prop: string }

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
  // On a COLUMN, `false` marks it computed. On a COMPONENT the word is an
  // extension vocabulary's (@yaks/sync reads it as a tier), so a string is a
  // legal spelling too — the loader carries it, it never reads it.
  persist?: boolean | string
  stamped?: boolean
  kind?: boolean
  before?: string[]
  wire?: boolean
  bare?: boolean
  // On a COLUMN a boolean (this column alone); on a COMPONENT the composite
  // column lists. `Vocab.indexes` merges the two spellings.
  unique?: boolean | string[][]
  index?: boolean | string[][]
  aliases?: Record<string, string>
  // an extension vocabulary's keywords ride here too (keywords.ts)
  [k: string]: unknown
}
