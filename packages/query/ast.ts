// The AST the yaks query format parses into, and the builders that construct
// the same shape from code. Everything here is plain serializable data — no
// class, no method, no schema. A node records the format (an operator, a list,
// a range, a directive) and never what a field means; deciding whether
// `status` is a property, a reference or an enum is left to a compiler that has
// a schema.
//
// That boundary is the point: `parse('.a=1 .b=2')` deep-equals
// `and(eq('a', '1'), eq('b', '2'))`. Builders and parser produce one shape, so
// a caller can hand-write a query, parse one, or convert between the two.

// The predicate operators, exactly as they are written in a query. Presence is
// `!`, absence is `=` with an empty value, `?` asks for a component alongside
// the filter without filtering on it, and `~=` is a literal substring test. Any
// richer meaning (a time range, a resolved reference) is derived from these by
// a compiler that has a schema, never built in here.
export type Op = '=' | '!=' | '~=' | '<' | '<=' | '>' | '>=' | '!' | '?'

// A value — the right-hand side of a predicate. A scalar carries its raw token
// verbatim (the schema decides whether it is a number, an id, an enum or a time
// phrase). A list means any-of (`a,b,c`); a range is inclusive unless
// `exclusiveEnd` (`x..y` against `x...y`); a time node is an explicit time
// phrase, built either by a builder or by a compiler promoting a scalar —
// `parse` never emits one, because telling a time literal from a plain word
// (`.domain=today`) needs the property's type. `timeSpan` (time.ts) is the
// recognizer a compiler uses to promote a scalar.
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

// A predicate: the dotted path as raw segments (never resolved to a
// component), an operator, and a value — null for the `!` and `?` forms, which
// take none.
export type Pred = {
  kind: 'pred'
  path: string[]
  op: Op
  value: Value | null
  /** Negate a reverse association child test (none rather than any). */
  not?: boolean
  /** Builder-only: the last path segment names a component, not a property. */
  facet?: boolean
  /** Child condition; path names the reverse association. Builders compose
   * conjunctions here; parsing uses it to preserve nested quantifiers. */
  where?: Clause
}

// A bare word: a full-text term over the document. `never` is the empty query,
// which selects nothing (an empty string, or a query with no clauses).
export type Text = { kind: 'text'; value: string }
export type Never = { kind: 'never' }

// The reserved directives — reserved names that sit in the clause list but
// rank, project, aggregate or bound the answer rather than filter it. Each
// carries only its raw tokens; a directive's path is raw segments, like a
// predicate's.
export type Order = { kind: 'order'; value: string }
export type Near = { kind: 'near'; value: string }
// `.refs=X` backlinks of X, `.refs` references anything, `!refs` references
// nothing (op '=' with an empty value).
export type Refs = { kind: 'refs'; op: '=' | '!'; value: string }
export type Count = { kind: 'count' }
export type Distinct = { kind: 'distinct'; path: string[] }
export type Tally = { kind: 'tally'; path: string[] }
// One projected property, and whether a change to it wakes a subscription (a
// trailing `~` projects the property but does not wake on it). `path` is raw
// segments.
export type FieldSel = { path: string[]; wake: boolean }
export type Fields = { kind: 'fields'; fields: FieldSel[] }
// `*` — carry every component of each selected entity. The widest projection
// there is, and a projection only: it does not affect which entities the query
// selects, so an evaluator reads it beside `fields` and never as a filter. It
// is a directive rather than a bare word precisely so it cannot fall through to
// the full-text term `*`, which matches nothing anywhere.
export type Every = { kind: 'every' }
export type Limit = { kind: 'limit'; n: number }
// The paging cursor: the spine number of the entity to continue past. It names
// an entity, never a position or an order key, so this one form pages any
// ordering — an evaluator works out where that entity sits.
export type After = { kind: 'after'; n: number }
// Carries stored edges back with the answer. `select` picks one edge type and
// optionally projects an endpoint through a reference property (`via`, raw
// segments); `peers` names the properties of the far endpoint (each a raw path)
// to carry back.
export type EdgeSelect = { type: string; via?: string[] }
export type Edges = {
  kind: 'edges'
  select?: EdgeSelect
  peers: string[][]
  limit?: number
}
// A qualifier: one argument of the bracket a path may carry (`.p[<=3]`,
// `.p[key=v]`, `.p[word]`). The bracket binds to the path and is read before
// any operator, so each kind of clause declares which qualifiers it accepts and
// refuses the rest by name; today only the walk takes one (its depth cap).
export type Qual = { key?: string; op?: string; value: string }

// A transitive walk: `.requires[<=3]->T-42` selects what reaches `target`
// through at most `depth` hops of `path`; `<-` walks the other way. The path is
// raw segments — a relation name or a reference property, which is schema. The
// optional cap bounds the hops; without it the walk is bounded by WALK_LIMIT
// rows instead. `target` is one entity, by eid or human id.
export type Dir = '->' | '<-'
export type Walk = {
  kind: 'walk'
  path: string[]
  dir: Dir
  depth?: number
  target: string
}
export let WALK_DEPTH = 16
// Default closure: no hop cap, at most this many non-seed nodes (nearest first).
export const WALK_LIMIT = 10_000

// ---- rule prefixes ---- A component name may carry a prefix character saying
// what a rule does with it. Two of those are ordinary predicates, because an
// evaluator can answer them from stored data alone: `.comp` is present, `!comp`
// is absent. The four below mean something only a rule can act on — the
// component to add before it runs, the gate that makes it run once, the
// components it writes, and the singleton resource it reads — and `$name` binds
// a variable, the way `$alias` names an entity in a bundle. An evaluator with
// no rule engine refuses them rather than guessing. A `+` or `*` may name a
// property and a value as well as a component — `+result.call=$call` — because
// the prefix already means "this is written", and naming the property is part
// of the same statement. A gate has no such form: an absence has no value.
export type Ensure = {
  kind: 'ensure'
  comp: string
  prop?: string
  value?: Value
}
export type Gate = { kind: 'gate'; comp: string }
export type Mutable = {
  kind: 'mutable'
  comp: string
  prop?: string
  value?: Value
}
export type Resource = { kind: 'resource'; comp: string }
// `-comp` — this write removed the component from the bound entity. The one
// clause no committed row can answer: what was removed leaves nothing to read,
// so only the write itself knows it (a rule's overlay, or an effect reading
// back what it just committed), and an evaluator with no such write available
// refuses rather than answering "none".
export type Gone = { kind: 'gone'; comp: string }
// A variable, and the value bound to it where the query gives one: `$x` alone
// names a slot, `$x=5` fills it. A query consisting of nothing but these is a
// set of bindings, which is what the arguments to a template invocation are.
export type Var = { kind: 'var'; name: string; value?: Value }

// Boolean composition. `parse` always returns an `and` at the root; a `|` in
// the query becomes an `or` among its clauses, and `or` is a builder as well.
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
  | Every
  | Limit
  | After
  | Edges
  | Walk
  | Ensure
  | Gate
  | Mutable
  | Resource
  | Gone
  | Var
  | And
  | Or

// The root node `parse` returns.
export type Query = And

// ---- builders ----

// What a builder accepts where a value is expected: a string or a number
// becomes a scalar, and a Value node passes through, so
// `eq('p', range('1', '5'))` composes.
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

// One factory, with an explicit signature on each export so the type is stated
// at the boundary (JSR reads it without running the call).
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

/**
 * Is this a bare component form — one segment, present (`.canvas`) or absent
 * (`!canvas`)? Either names a component, so an evaluator resolves it to that
 * component even where a property of the same name would otherwise win the
 * bare form (@yaks/vocab's `aim(path, facet)`).
 *
 * ```ts
 * import { absent, bare, eq, present } from '@yaks/query'
 *
 * bare(present('canvas')) // true
 * bare(absent('canvas')) // true
 * bare(eq('canvas', 'x')) // false
 * ```
 */
export let bare = (p: Pred): boolean =>
  p.path.length == 1 &&
  (p.op == '!' && !p.value ||
    p.op == '=' && p.value?.kind == 'scalar' && p.value.raw == '')

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
export let walk = (
  field: string,
  dir: Dir,
  target: string,
  depth?: number,
): Walk => ({ kind: 'walk', path: dot(field), dir, depth, target })

// A field selector from `'pin.x'`, or from `'pin.z~'` for a property that does
// not wake a subscription — or a FieldSel that is already built.
export let field = (spec: string | FieldSel): FieldSel => {
  if (typeof spec != 'string') return spec
  let wake = !spec.endsWith('~')
  return { path: dot(wake ? spec : spec.slice(0, -1)), wake }
}
export let fields = (...specs: (string | FieldSel)[]): Fields => ({
  kind: 'fields',
  fields: specs.map(field),
})
export let every = (): Every => ({ kind: 'every' })

// The rule prefixes. `ensure` adds a component before the rule runs; `gate`
// adds one that had to be absent, which is what makes a rule run once;
// `mutable` declares a component the rule writes; `resource` names a
// singleton; and `variable` binds a name. Presence and absence have builders
// already (`present`, `absent`) — they are predicates, not rule instructions.
export let ensure = (comp: string, prop?: string, value?: Input): Ensure => ({
  kind: 'ensure',
  comp,
  ...(prop ? { prop, value: coerce(value ?? '') } : {}),
})
export let gate = (comp: string): Gate => ({ kind: 'gate', comp })
export let mutable = (comp: string, prop?: string, value?: Input): Mutable => ({
  kind: 'mutable',
  comp,
  ...(prop ? { prop, value: coerce(value ?? '') } : {}),
})
export let resource = (comp: string): Resource => ({ kind: 'resource', comp })
export let gone = (comp: string): Gone => ({ kind: 'gone', comp })
export let variable = (name: string, value?: Input): Var => ({
  kind: 'var',
  name,
  ...(value === undefined ? {} : { value: coerce(value) }),
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
// The clause list a compiler such as @yaks/sql reads its directives out of,
// plus a few of the common lookups, written once so every caller need not scan
// the list by hand.

export let clauses = (ast: Query): Clause[] => ast.clauses

export let orderOf = (ast: Query): string | undefined =>
  ast.clauses.find((c): c is Order => c.kind == 'order')?.value

export let nearOf = (ast: Query): string | undefined =>
  ast.clauses.find((c): c is Near => c.kind == 'near')?.value

// The window a query asks for, collected from its `.limit` and `.after`
// clauses.
export let windowOf = (ast: Query): { limit?: number; after?: number } => {
  let out: { limit?: number; after?: number } = {}
  for (let c of ast.clauses) {
    if (c.kind == 'limit') out.limit = c.n
    if (c.kind == 'after') out.after = c.n
  }
  return out
}
