// The AST the yaks query format parses into, and the builder vocabulary that
// constructs the SAME shape from code. Everything here is plain serializable
// data — no class, no method, no schema. A node knows the FORMAT (an operator,
// a list, a range, a directive) and never what a field means; deciding whether
// `status` is a real column, a ref, or an enum is a downstream (schema) job.
//
// The whole point of the boundary: `parse('.a=1&.b=2')` deep-equals
// `and(eq('a', '1'), eq('b', '2'))`. Builders and parser meet on one shape, so
// a caller may hand-write a query, parse one, or transform between the two.

// The eight predicate operators, exactly as the text spells them. Presence is
// `!`, absence is `=` with an empty value, `?` requests a component beside the
// filter (WANT), `~=` is a literal contains. Every richer meaning (a time
// range, a ref resolution) is read off these downstream, never baked in here.
export type Op = '=' | '!=' | '~=' | '<' | '<=' | '>' | '>=' | '!' | '?'

// A VALUE — the right-hand side of a predicate. A scalar carries its raw token
// verbatim (schema decides if it is a number, an id, an enum, a time phrase). A
// list is any-of (`a,b,c`); a range is inclusive unless `exclusiveEnd` (`x..y`
// vs `x...y`); a time node is an EXPLICIT time phrase a builder or a downstream
// promotion made — `parse` never emits one, because telling a time literal from
// a plain word (`.domain=today`) needs the column's type. `timeSpan` (time.ts)
// is the generic recognizer downstream uses to promote a scalar.
export type Scalar = { kind: 'scalar'; raw: string }
export type List = { kind: 'list'; items: Value[] }
export type Range = {
  kind: 'range'
  lo: Value
  hi: Value
  exclusiveEnd: boolean
}
export type Time = { kind: 'time'; raw: string }
export type Value = Scalar | List | Range | Time

// A PREDICATE: the dotted path as raw segments (never routed to a component),
// an operator, and a value — null for the value-less `!` and `?` forms.
export type Pred = { kind: 'pred'; path: string[]; op: Op; value: Value | null }

// A bare word: a full-text term over the document. `never` is the empty query,
// which selects nothing (an empty string, or a query with no clauses).
export type Text = { kind: 'text'; value: string }
export type Never = { kind: 'never' }

// The reserved DIRECTIVES — format words that ride the clause list but rank,
// project, aggregate, or bound rather than filter. Each carries only its raw
// tokens; a directive's path is unrouted segments like a predicate's.
export type Order = { kind: 'order'; value: string }
export type Near = { kind: 'near'; value: string }
// `.refs=X` backlinks of X, `.refs!` references anything, `.refs=` references
// nothing (op '=' with an empty value).
export type Refs = { kind: 'refs'; op: '=' | '!'; value: string }
export type Count = { kind: 'count' }
export type Distinct = { kind: 'distinct'; path: string[] }
export type Tally = { kind: 'tally'; path: string[] }
// One projected column and whether a change to it wakes a subscription (a
// trailing `~` marks it volatile — projected but muted). `path` is raw segments.
export type FieldSel = { path: string[]; wake: boolean }
export type Fields = { kind: 'fields'; fields: FieldSel[] }
export type Limit = { kind: 'limit'; n: number }
export type After = { kind: 'after'; n: number }
// A stored-edge rider. `select` picks one edge type and optionally projects an
// endpoint through a reference column (`via`, raw segments); `peers` names the
// far-endpoint columns (each a raw path) to carry back.
export type EdgeSelect = { type: string; via?: string[] }
export type Edges = { kind: 'edges'; select?: EdgeSelect; peers: string[][] }
// A bounded traversal: reach `target` through at most `depth` edges of one
// type. The depth cap is part of the grammar — an unbounded closure has no
// spelling. `edgeType` is unvalidated here (which types exist is schema).
export type Reaches = {
  kind: 'reaches'
  edgeType: string
  depth: number
  target: string
}

// Boolean composition. `parse` always yields an `and` of the token clauses
// (the yaks text format is a flat AND-list); `or` is builder-only — the AST is
// a superset of what the current text grammar can spell.
export type And = { kind: 'and'; clauses: Clause[] }
export type Or = { kind: 'or'; clauses: Clause[] }

// Anything that can sit in a clause list.
export type Clause =
  | Pred
  | Text
  | Never
  | Order
  | Near
  | Refs
  | Count
  | Distinct
  | Tally
  | Fields
  | Limit
  | After
  | Edges
  | Reaches
  | And
  | Or

// The root a `parse` returns.
export type Query = And

// ---- builders ----

// What a builder accepts where a value is wanted: a string or number becomes a
// scalar; a Value node passes through, so `eq('p', range('1', '5'))` composes.
export type Input = string | number | Value

let dot = (field: string): string[] => field.split('.')

export let coerce = (v: Input): Value =>
  typeof v == 'string'
    ? { kind: 'scalar', raw: v }
    : typeof v == 'number'
    ? { kind: 'scalar', raw: String(v) }
    : v

export let scalar = (raw: string): Scalar => ({ kind: 'scalar', raw })
export let list = (...items: Input[]): List => ({
  kind: 'list',
  items: items.map(coerce),
})
export let range = (lo: Input, hi: Input, exclusiveEnd = false): Range => ({
  kind: 'range',
  lo: coerce(lo),
  hi: coerce(hi),
  exclusiveEnd,
})
export let time = (raw: string): Time => ({ kind: 'time', raw })
export let text = (value: string): Text => ({ kind: 'text', value })
export let never = (): Never => ({ kind: 'never' })

// One factory, an explicit signature on each export so the type is written at
// the boundary (JSR reads it without running the call).
let op = (o: Op) => (field: string, value: Input): Pred => ({
  kind: 'pred',
  path: dot(field),
  op: o,
  value: coerce(value),
})
export let eq: (field: string, value: Input) => Pred = op('=')
export let ne: (field: string, value: Input) => Pred = op('!=')
export let contains: (field: string, value: Input) => Pred = op('~=')
export let lt: (field: string, value: Input) => Pred = op('<')
export let le: (field: string, value: Input) => Pred = op('<=')
export let gt: (field: string, value: Input) => Pred = op('>')
export let ge: (field: string, value: Input) => Pred = op('>=')

// The value-less predicate forms.
export let present = (field: string): Pred => ({
  kind: 'pred',
  path: dot(field),
  op: '!',
  value: null,
})
export let absent = (field: string): Pred => ({
  kind: 'pred',
  path: dot(field),
  op: '=',
  value: { kind: 'scalar', raw: '' },
})
export let want = (field: string): Pred => ({
  kind: 'pred',
  path: dot(field),
  op: '?',
  value: null,
})
export let pred = (field: string, o: Op, value: Value | null): Pred => ({
  kind: 'pred',
  path: dot(field),
  op: o,
  value,
})

export let and = (...clauses: Clause[]): And => ({ kind: 'and', clauses })
export let or = (...clauses: Clause[]): Or => ({ kind: 'or', clauses })

export let order = (value: string): Order => ({ kind: 'order', value })
export let near = (value: string): Near => ({ kind: 'near', value })
export let refs = (value = ''): Refs => ({ kind: 'refs', op: '=', value })
export let hasRefs = (): Refs => ({ kind: 'refs', op: '!', value: '' })
export let count = (): Count => ({ kind: 'count' })
export let distinct = (field: string): Distinct => ({
  kind: 'distinct',
  path: dot(field),
})
export let tally = (field: string): Tally => ({
  kind: 'tally',
  path: dot(field),
})
export let limit = (n: number): Limit => ({ kind: 'limit', n })
export let after = (n: number): After => ({ kind: 'after', n })
export let reaches = (
  edgeType: string,
  depth: number,
  target: string,
): Reaches => ({ kind: 'reaches', edgeType, depth, target })

// A field selector from `'pin.x'` or `'pin.z~'` (volatile), or a ready one.
export let field = (spec: string | FieldSel): FieldSel => {
  if (typeof spec != 'string') return spec
  let wake = !spec.endsWith('~')
  return { path: dot(wake ? spec : spec.slice(0, -1)), wake }
}
export let fields = (...specs: (string | FieldSel)[]): Fields => ({
  kind: 'fields',
  fields: specs.map(field),
})

export let edges = (
  opts: { select?: EdgeSelect; peers?: string[][] } = {},
): Edges => ({
  kind: 'edges',
  peers: opts.peers ?? [],
  ...(
    opts.select ? { select: opts.select } : {}
  ),
})

// ---- accessors ----
// The clause list an @yaks/sql compiler reads a directive off; a few of the
// common ones, spelled once so downstream need not re-scan by hand.

export let clauses = (ast: Query): Clause[] => ast.clauses

export let orderOf = (ast: Query): string | undefined =>
  ast.clauses.find((c): c is Order => c.kind == 'order')?.value

export let nearOf = (ast: Query): string | undefined =>
  ast.clauses.find((c): c is Near => c.kind == 'near')?.value

// The window a query asks for, folded from its `.limit`/`.after` clauses.
export let windowOf = (ast: Query): { limit?: number; after?: number } => {
  let out: { limit?: number; after?: number } = {}
  for (let c of ast.clauses) {
    if (c.kind == 'limit') out.limit = c.n
    if (c.kind == 'after') out.after = c.n
  }
  return out
}
