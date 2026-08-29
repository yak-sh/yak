// The FILTER grammar — dot-params in URL query-param form. One parser for
// every reader: a board's saved query, `task list`, MCP task_list, and
// the search box. (Writes keep the plain `.prop=value` setter grammar in
// client.ts — a setter's comma is a literal comma; only filters interpret
// value forms.)
//
//   .status=open&.priority<=1&.domain=Ops,Eng
//   runner exit .status=done .updated.at=today      (search-style mix)
//
//   .prop=v          equals (string-compared, like everything on the wire)
//   .prop=a,b,c      any of
//   .prop=1..5       range, inclusive (1...5 excludes the end; ISO dates
//                    compare fine lexicographically)
//   .prop=           null / absent
//   .prop!            present (including an empty string)
//   .prop!=v         not — negates any value form above
//   .prop~=v         contains, case-insensitive
//   .prop<v <=v >v >=v   comparisons (numeric when both sides are numbers)
//
//   .limit=200       a WINDOW: the newest 200 matches, not the whole set
//   .after=13882     continue that window below a spine num (the next page)
//
// Bare words are TEXT preds — FTS5 terms over the doc (title or body), with a
// trailing `*` for token-prefix matching; "quoted words" stay one phrase pred.
// Separators are '&' and
// whitespace both: an &-segment that is one dot-param keeps its spaces
// (.title~=two words survives), a segment with embedded ` .` splits.
//
// When the ROW value is an ISO timestamp, the filter value may be a time
// PHRASE (see span): today, yesterday, tomorrow, now, this|last|next
// minute|hour|day|week|month|year, "5 minutes ago", "in 2 days" (short
// units too: in 60m, after 8h), a clock time on today or a named day
// (9am, 9:30pm, 14:00, noon, "9am tomorrow"), a date, or a full stamp
// (2026-07-25T09:00) — with '-'/'_' glue where quoting is awkward:
// 1-hour-ago. A phrase names a
// RANGE and the op picks its edge: = within, >= from its start, <= until
// its end, > strictly after, < strictly before. So .updated.at=today is
// midnight-to-midnight, .updated.at>="1 hour ago" is the last hour.
// Schedulers want one moment instead — that's instant(), below span.
//
// Unqualified props route by component, same rule as writes; `.task.status`
// is the explicit spelling. A component name by itself tests the facet:
// `.proposed=` means absent, `.proposed!` present. `.num` routes to the entity
// spine; `at`/`by` are shared by the stamps — created, updated, decided,
// proposed, archived — so spell those out (`.created.at`, `.archived.at`).
//
// References are ordinary props: `.assignee=jeff`; the VALUE resolves like
// any id (alias, T-3, raw eid) at whichever door or evaluator holds the graph
// (resolveRefs). And a
// dotted first segment that names a COMPONENT is the explicit spelling
// (`.pin.x=12`); any other first segment is a PATH — `.assignee.title~=j`
// dereferences the eid column and predicates the target's prop. A path is an
// N-hop CHAIN: each `{eid}` deref moves to the target entity and the next
// segment(s) read there, so `.comment.target.doc.title~=foo` walks
// comment→target then tests doc.title, arbitrarily deep (groupsOf).
import { bareType, isRef, parseProp, type Prop, propAt } from './props.ts'
import {
  comps,
  derivedProps,
  edges,
  kindOrder,
  kindWord,
  propRenames,
  sessionComps,
  sessionFacetNames,
  stamped,
  statusOf,
} from './types.ts'
import { type Span, span } from './time.ts'

// One rung of a path predicate: a component's column read on the entity this
// hop lands on. Every hop but the last is an `{eid}` deref; the last is the
// leaf tested against op/value.
export type Hop = { comp: string; prop: string }

// A stored-edge selector carried by the EDGES rider. `type` narrows dependency
// sentences; `via` replaces an endpoint wearing that component with the entity
// its reference column names. The projection is what lets an entry-owned edge
// read as session-owned without loading the entry partition.
export type EdgeSelector = { type: string; via?: Hop }

export type Pred = {
  comp: string
  prop: string
  op: string
  value: string
  // A path predicate's chain: deref the reference at `comp.prop`, then follow
  // each hop in `at` in turn — every hop but the LAST is another `{eid}` deref
  // — and test the final hop's column against op/value. A single-element `at`
  // is one deref, the depth-1 path `.assignee.title`; `.comment.target.doc.title`
  // is that same deref spelled with explicit `comp.prop` on both sides.
  at?: Hop[]
  // A REVERSE hop: the entities whose `rev.comp.rev.prop` reference points BACK
  // at this one (`.comments` = the comments whose comment.target is me). The
  // mirror of `at` — one-to-many instead of one deref — so it carries the
  // existential/count semantics `at` never needs. See Rev.
  rev?: Rev
  // A MULTI-COLUMN reverse-union: match any entity that references `value`
  // through SOME `{eid}` column — the backlinks of `value`, the union of every
  // reverse lookup the vocabulary implies (`.refs=T-3`). comp/prop stay empty:
  // the union spans refCols, so anchor unions the reverse index and sql.ts
  // unions the ref tables. `.comment.target=T-3` is one column of this.
  refs?: boolean
  // An AGGREGATE projection rather than a filter: `agg` names the reduction
  // over this pred's column — `distinct` its non-empty values, `tally` each
  // value's count. `count` reduces the SELECTION itself, so it names no column
  // and leaves comp/prop empty. op is AGG, so matchQuery passes it through (the
  // filter part selects the universe); aggOf()/tally()/aggregateSql() read it.
  agg?: 'distinct' | 'tally' | 'count'
  // A FIELD PROJECTION rather than a filter: the columns each result row carries
  // beyond its eid (`.fields=pin.x,pin.z~`), so a partial-cache subscription
  // reads live values without holding the whole graph. op is PROJECT, matchQuery
  // passes it through; fieldsOf() reads it and select() (sql.ts) selects the
  // columns. comp/prop stay empty — the columns live in `fields`, each carrying
  // its own `wake` (a `~`-marked column is projected but excluded from the
  // change-signal, so a churny value like a pin's z delivers yet never re-fires).
  fields?: Field[]
  // A WINDOW rather than a filter: `.limit=200` bounds the answer to a prefix,
  // `.after=<num>` continues it below a spine num. op is WINDOW, so matchQuery
  // passes it through (the filter part selects the whole set) and windowOf()
  // reads the bound; comp/prop stay empty. A window states a SIZE, never a
  // membership — which is why a reply that carries one also states the total it
  // is a prefix of.
  win?: Win
  // The EDGES RIDER's peer projection: `.edges.peers=status,title` names the
  // columns the FAR endpoint of each incident edge carries into the reply, so a
  // requires-tree renders (id, status) without subscribing every blocker row.
  // Empty for a bare `.edges!`. op is EDGES; edgeRider() reads the directive.
  peers?: Hop[]
  edge?: EdgeSelector
  // A bounded TRAVERSAL rather than a column read: `.reaches[requires,<=3]=T-42`
  // selects the entities that reach `value` through at most `depth` edges of one
  // type. op is REACHES. The cap is part of the grammar — an unbounded closure
  // over the edge table is refused, never silently walked (M-17862).
  reach?: { type: string; depth: number }
}

// A window: how many of the selection to answer with, and where to continue.
// Both optional — `.limit=` alone is the first page, `.after=` alone continues
// an unbounded read below a cursor. Newest-first by spine num is the order
// every windowed door answers in, so `after` reads as "older than this num".
export type Win = { limit?: number; after?: number }

// One projected column: which component column a result row carries, and whether
// a change to it WAKES the subscription. `wake: false` (a `~`-suffixed field) is
// VOLATILE — its value still rides in the row, but a live layer excludes it from
// the change-signal it wakes on. Membership always wakes; volatility only mutes
// this one column's own edits.
export type Field = { comp: string; prop: string; wake: boolean }

// A reverse hop resolved: the child component + ref column whose value the
// parent's eid must equal, and how the many children collapse to a yes/no.
// Existential (the default): keep the parent if ANY child matches `preds` —
// `[]` is "any child at all". `not` flips it to NOT EXISTS, which is NONE, and
// with a negated leaf it is ALL by De Morgan (`.comments!.status!=done` = no
// child is un-done = every child is done). `count` instead compares the NUMBER
// of children to the outer pred's op/value (`.comments>=5`), ignoring preds.
export type Rev = {
  comp: string
  prop: string
  preds: Pred[]
  not: boolean
  count?: boolean
}

// A path's leaf — the far column op/value tests — is the last hop; a plain
// pred is its own leaf. Every reader resolving the tested column (its type,
// ref-resolution, quarantine reveal) reads THROUGH this, never `p.comp`.
export let leafOf = (p: Pred): Hop => p.at ? p.at[p.at.length - 1] : p

// What a pred evaluates against: an entity's components, merged — the
// shape of both a live-cache row and a client Row's `.comps`.
type Comps = Record<string, Record<string, unknown> | undefined>

// Query-result-only components speak the same component grammar as stored
// graph data. They are readable results, never members of the writable `comps`
// vocabulary; the query engine supplies their declared inputs and values.
export let resultComps = {
  materialized: { text: true, scoped: true },
} as const
export type ResultComp = keyof typeof resultComps

// The readable routing table is the union of the wire, server, and transient
// result vocabularies. Keeping it derived means every readable column is
// immediately filterable through `.component.prop` without becoming writable.
let routes: Record<string, readonly string[]> = Object.fromEntries(
  [
    ...new Set([
      ...Object.keys(comps),
      ...Object.keys(stamped),
      ...Object.keys(resultComps),
      ...Object.keys(derivedProps),
    ]),
  ].map((name) => [
    name,
    Object.keys({
      ...comps[name],
      ...stamped[name],
      ...resultComps[name as ResultComp],
      ...derivedProps[name],
    }),
  ]),
)

// A name a column or component already routes — the real props pred() resolves
// before any scope. A scope may not shadow one, so this is how the pred seam
// gives `.status`/`.project` priority over a same-named virtual prop.
let owned = (name: string) =>
  name in routes || Object.values(routes).some((cols) => cols.includes(name))

// Every `{eid}` reference column in the vocabulary — wire-writable `comps`
// UNION the server-stamped columns (a session's `requested_task` is a reference
// even though the wire can't write it). `[comp, prop]` pairs; both the in-memory
// reverse index (index.ts realizes it) and the reverse-hop grammar below key off
// this ONE list, so a new ref column gets its reverse view for free (CLAUDE.md,
// "the vocabulary is one list"). index.ts re-exports it as the index derivation.
export let refCols: [string, string][] = [
  ...new Set([...Object.keys(comps), ...Object.keys(stamped)]),
].flatMap((c) =>
  Object.keys({ ...comps[c], ...stamped[c] })
    .filter((p) => isRef(c, p))
    .map((p) => [c, p] as [string, string])
)

// The synthetic prop the multi-column reverse-union resolves its value through:
// a plain entity reference with no owning column, so `.refs=T-3` turns T-3 into
// its eid at delivery exactly as a real `{eid}` column would (resolveRefs).
let REFS_PROP: Prop = {
  comp: '',
  prop: 'refs',
  name: 'refs',
  type: { eid: 'entity', death: 'keep' },
}

// A reverse ASSOCIATION: a component's `{eid}` ref column seen from the far side.
// `.comments` are the entities whose comment.target points at me. One per ref
// column, DERIVED from refCols — never hand-listed — named plural(comp) when the
// comp has a single ref column, plural(comp)_{prop} when several ref columns
// share the plural (the prop says which pointer). English is not the goal;
// uniqueness is (shelf→shelfs is fine). A name colliding with a real prop is a
// load error, so a real column always wins its spelling — the scopes discipline.
export type Assoc = { comp: string; prop: string }
let plural = (s: string) =>
  s.endsWith('y') ? s.slice(0, -1) + 'ies' : s.endsWith('s') ? s : s + 's'
export let reverseAssocs: Map<string, Assoc> = (() => {
  let byComp = new Map<string, string[]>()
  for (let [c, p] of refCols) byComp.set(c, [...(byComp.get(c) ?? []), p])
  let m = new Map<string, Assoc>()
  for (let [c, p] of refCols) {
    let name = byComp.get(c)!.length == 1 ? plural(c) : `${plural(c)}_${p}`
    m.set(name, { comp: c, prop: p })
  }
  return m
})()
for (let name of reverseAssocs.keys()) {
  if (owned(name)) throw new Error(`reverse assoc .${name} shadows a real prop`)
}

// The reserved query WORDS — directives that are neither a column nor an
// association: `.refs` (the multi-column reverse-union), the `.distinct` /
// `.tally` aggregates, `.fields` (the projection), `.limit`/`.after` (the
// window), `.edges` (the incident-edge rider), `.reaches` (the bounded
// traversal). Guarded here the way scopes and reverse assocs are, so a
// vocabulary that ever grows one of these as a real prop is a load error rather
// than a silently dead directive.
export let reserved = [
  'refs',
  'distinct',
  'tally',
  'fields',
  'limit',
  'after',
  'edges',
  'reaches',
]
for (let name of reserved) {
  if (owned(name)) {
    throw new Error(`reserved query word .${name} shadows a prop`)
  }
}

// The dot-param shape, sketched — the tail of every strict rejection
// (FILTERS in grammar.ts spells the operators).
let SKETCH =
  'filters are dot-params: .status=open, .priority<=1, .project=P-19, .title~=word, …'

// The names agents reach for that are EDGES — a dependency has no column
// and never will, so the sketch answers the wrong question in either
// grammar. The door says what it DOES ('link one'), because from a filter
// this is the shape of the mistake, not a listing verb.
export let edgeish = /block|depend|require|parent|child|subtask/i
export let EDGE_DOOR = 'a dependency is an EDGE, not a prop: ' +
  "link one with 'task <parent> requires <child>'"

// An edge word used as a path HOP: walking `dependency` triples is one-to-many
// (any/all semantics), a different traversal than this {eid}-column deref, and
// its own ticket. The refusal names it so the two are never conflated.
export let EDGE_HOP = (word: string) =>
  `.${word} walks dependency edges, not an {eid} column — edge-hop traversal ` +
  'is T-14078; a column path derefs reference props (.comment.target.doc.title)'

let sessionFacets = new Set<string>(sessionFacetNames)
let sessionTwin = (owners: string[]) =>
  owners.includes('session') &&
  owners.some((name) => sessionFacets.has(name)) &&
  owners.every((name) => name == 'session' || sessionFacets.has(name))

// Component columns that never claim their BARE prop spelling — an established
// bare filter of a different concept already owns it, so the newcomer is
// reached only through its component (`.fork.from`). `fork.from` (the fork-
// point entry) yields bare `.from` to the shipped `mail.from` sender filter.
let bareShy = new Set(['fork.from'])

// These associations already had one bare filter across several suffixed
// columns. Keep that reading after the columns take their canonical names;
// other collisions (`by`, `at`) remain explicit as before.
let sharedRefs = new Set(['actor', 'canvas', 'client', 'scope', 'target'])
let sharedRef = (prop: string, owners: string[]) =>
  owners.length > 1 && sharedRefs.has(prop) && isRef('', prop)

// Old bare prop → current, so a stored board.query written before a column
// rename keeps answering. Derived from the ONE renames table (types.ts, prop
// projection): only a rename that CHANGES the column name matters here — a
// whole-component rename keeps its columns, which still route through the new
// component in `routes` above. Empty today (session↔spawn keeps its column
// names and is the twin window, not a rename). Exported so a test drives the
// derivation with its own map before the first real column rename lands.
export let bareRenamesOf = (
  map: Record<string, string>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(map)
      .filter(([k, v]) => k.includes('.') && v.includes('.'))
      .map(([k, v]) => [k.split('.')[1], v.split('.')[1]])
      .filter(([from, to]) => from != to),
  )
let bareRenames = bareRenamesOf(propRenames)

// Route a bare prop to its component; ambiguity is an error that names the
// candidates rather than a guess. Same-named references are one read concept:
// comp '' makes a filter scan every owner, while writes demand a component.
export let route = (prop: string): { comp: string; prop: string } => {
  prop = bareRenames[prop] ?? prop
  let hits = (p: string) =>
    Object.entries(routes)
      .filter(([, cols]) => cols.includes(p))
      .map(([name]) => name)
      // Session-log columns are an explicitly addressed lazy partition.
      // Bare graph props keep their shipped meanings; log predicates say
      // `.response.status`, `.content.body`, `.generation.provider`, etc.
      .filter((name) => !(name in sessionComps))
      // A newcomer that shares a name with an ESTABLISHED bare filter of a
      // different concept never steals the bare spelling — it is reached
      // qualified by its component. `fork.from` (the fork-point entry ref, a
      // session facet) shares `from` with the shipped `.from` = `mail.from`
      // sender filter (query.ts:659, `task inbox .from=…`); the writable-vs-
      // stamped rule below would silently repoint bare `.from` onto the fork
      // ref, so bare `.from` keeps meaning mail's sender and `.fork.from`
      // reaches the fork — the same "bare keeps its shipped meaning, qualified
      // reaches the newcomer" split parent/child already use.
      .filter((name) => !bareShy.has(`${name}.${p}`))
  let own = hits(prop)
  // A stamped lifecycle field may share a name with an established writable
  // filter (`session.status` and `task.status`). Qualified reads reach both;
  // bare routing keeps the writable — or derived (D-24102) — spelling instead of
  // manufacturing a new ambiguity. `task.status` is a DERIVED column now, no
  // longer writable, so it must still win bare `.status` over stamped
  // `session.status`. When every owner is stamped, the normal ambiguity/twin
  // rules below still apply.
  let preferred = own.filter((name) =>
    prop in (comps[name] ?? {}) || prop in (derivedProps[name] ?? {})
  )
  if (preferred.length) own = preferred
  // Parent/child words are the dependency vocabulary. Their component refs
  // remain available through `.pane.parent` / `.session.parent`; bare keeps
  // teaching the edge door instead of silently changing an old mistake.
  // A real component is never edge vocabulary, though — `blocked` merely
  // CONTAINS `block`, so the broad net would swallow a genuine facet. Guard
  // it: a registered component keeps its owners and reaches the presence
  // grammar below, so `.blocked!` filters what is stuck rather than teaching
  // the edge door. Only NON-components fall to the door.
  if (edgeish.test(prop) && !(prop in comps)) own = []
  if (own.length == 1) return { comp: own[0], prop }
  // Spawn's legacy session aliases are one concept during the rolling
  // window: filters read either home, while write routing chooses explicitly.
  if (sessionTwin(own)) return { comp: '', prop }
  if (sharedRef(prop, own)) return { comp: '', prop }
  if (own.length > 1) {
    throw new Error(
      `.${prop} is ambiguous (${own.join(', ')}) — use .${own[0]}.${prop}`,
    )
  }
  // A facet is itself filterable. Scalar and reference columns win above,
  // preserving `.project=P-3`; a component with no namesake column gets the
  // presence grammar (`=` absent, `~=` present) without a second vocabulary.
  if (prop in routes) return { comp: prop, prop: '' }
  // The rejection is the teaching moment: agents keep reaching for eid as a
  // filter prop — name what the asker meant. (.kind is a SCOPE handled before
  // route() and .id routes through session.id, so neither reaches here.)
  throw new Error(
    prop == 'eid'
      ? 'address entities by id directly (T-3, E-9) — filters match component props'
      : `unknown prop: .${prop} — ${edgeish.test(prop) ? EDGE_DOOR : SKETCH}`,
  )
}

// One token — '.priority<=1', '.domain=Ops,Eng' — to a Pred; null if the
// string isn't a dot-param at all.
export let EXISTS = 'exists'
let OPS: Record<string, string> = {
  '=': '',
  '!': EXISTS,
  '!=': '!',
  '~=': '~',
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
}

// `.order=hot`, `.order=search`, and `.order=similar` are rankings, not filters: matchQuery lets
// them through, adopt() ignores them, and orderOf() hands the value to whoever
// sorts. Search is explicit so a filter-only picker can request recent-first
// results without changing ordinary query order. Similar asks the evaluator
// that owns the embedding service for vector-neighbor rank.
export let ORDER = 'order'

export let orderOf = (preds: Pred[]) => preds.find((p) => p.op == ORDER)?.value

// `.near=T-3` names the entity whose doc supplies a similarity query. It is a
// ranking input beside ORDER, never graph membership: the evaluator resolves
// it and projects transient rank onto the selected neighbors.
export let NEAR = 'near'
export let nearOf = (preds: Pred[]) => preds.find((p) => p.op == NEAR)?.value

// An AGGREGATE directive rides the pred list like ORDER — `.distinct=domain`,
// `.tally=domain`, `.count!`. matchQuery passes AGG through (true), so the OTHER
// preds select the universe the aggregate reduces; a reader pulls the projection
// with aggOf() and computes it with tally() (or aggregateSql server-side).
export let AGG = 'agg'

// `count` names no column, so its `at` is the empty hop — a reader branches on
// `op`, never on whether `at` is populated.
export let aggOf = (
  preds: Pred[],
): { op: 'distinct' | 'tally' | 'count'; at: Hop } | undefined => {
  let p = preds.find((p) => p.op == AGG)
  return p?.agg ? { op: p.agg, at: { comp: p.comp, prop: p.prop } } : undefined
}

// A WINDOW directive rides the pred list like ORDER/AGG/PROJECT —
// `.limit=200&.after=13882`. matchQuery passes WINDOW through (true), so the
// OTHER preds select the whole membership and the window only bounds how much
// of it a door answers with.
export let WINDOW = 'window'

// The window a query asks for, folded from every WINDOW pred it carries — so
// `.limit=50&.after=900` reads as one bound however it was spelled, and a later
// pred wins a repeated one. `{}` when the query names no window: a door reads
// `limit == null` as "the whole answer", which is what keeps an unwindowed
// query's frame semantics exactly what they were.
export let windowOf = (preds: Pred[]): Win => {
  let out: Win = {}
  for (let p of preds) {
    if (p.op != WINDOW || !p.win) continue
    if (p.win.limit != null) out.limit = p.win.limit
    if (p.win.after != null) out.after = p.win.after
  }
  return out
}

// The components a pred list READS — the dirty test an aggregate subscription
// applies to a committed batch: a change dirties the aggregate iff it touches a
// component the selection or the aggregated column reads. `null` means "every
// batch dirties it": a path hop, a reverse hop or a `.refs` union reads columns
// on OTHER entities, which no comp-name overlap can name, so those recompute
// unconditionally rather than answer stale. The spine (`entity`) and
// `quarantined` are the caller's to add — every query reads them.
export let predComps = (preds: Pred[]): Set<string> | null => {
  let out = new Set<string>()
  for (let p of preds) {
    if (p.refs || p.at || p.rev) return null
    if (
      p.op == NEVER || p.op == ORDER || p.op == NEAR || p.op == PROJECT
    ) continue
    if (p.op == WINDOW) continue
    // `.count!` aggregates the selection, naming no column of its own.
    if (p.op == AGG && !p.comp) continue
    if (!p.comp) return null
    // task.status is virtual: a filter/window/aggregate over it reads all four
    // lifecycle facets, not only the task row that owns the public spelling.
    // Without this expansion a claim or terminal mark changes the answer but
    // never dirties a standing tally or exact window.
    if (p.comp == 'task' && p.prop == 'status') {
      for (let comp of ['task', 'completed', 'cancelled', 'claim']) {
        out.add(comp)
      }
    } else out.add(p.comp)
  }
  return out
}

// The aggregate itself, over the rows a query matched: value → count, empties
// (null and '') dropped exactly as the census always has. Distinct values are
// its keys; a reader that wants them sorted takes `[...tally(rows, at).keys()]`.
export let tally = (
  rows: Iterable<Comps>,
  at: Hop,
): Map<string, number> => {
  let m = new Map<string, number>()
  for (let c of rows) {
    // read() so a DERIVED column (task.status) tallies its computed value, not
    // the absent stored one — board column counts stay honest (D-24102).
    let v = read(c, at.comp, at.prop)
    if (v == null || v === '') continue
    let k = String(v)
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}

// The census in one line: the sorted distinct values of a column over `rows`.
export let distinctValues = (rows: Iterable<Comps>, at: Hop): string[] =>
  [...tally(rows, at).keys()].sort()

// A FIELD PROJECTION directive rides the pred list like AGG/ORDER —
// `.fields=pin.x,pin.z~`. matchQuery passes PROJECT through (true), so the OTHER
// preds select the membership; fieldsOf() reads which columns each row carries
// (and which are volatile), and select() (sql.ts) selects them.
export let PROJECT = 'project'

// The projected columns of a query, or undefined when it names none — a plain
// membership query. The waking subset is `f.wake`; a caller that only cares which
// changes should re-fire reads `fields.filter((f) => f.wake)`.
export let fieldsOf = (preds: Pred[]): Field[] | undefined =>
  preds.find((p) => p.op == PROJECT)?.fields

// The EDGES RIDER — `.edges!`, optionally `.edges.peers=status,title`. A typed
// form (`.edges[referenced,entry.session]!`) selects stored sentences after
// projecting endpoints through one reference column. It rides the pred list
// like AGG/PROJECT and delivers triples INCIDENT to its result set — the scoped
// replacement for shipping every edge at boot. `peers` names far-end columns.
export let EDGES = 'edges'

// The rider a query carries, or undefined for a plain membership query. Several
// `.edges` tokens union their peer columns — one rider, one delivery.
export type EdgeRider = { peers: Hop[]; select?: EdgeSelector }

export let edgeRider = (preds: Pred[]): EdgeRider | undefined => {
  let asked = preds.filter((p) => p.op == EDGES)
  if (!asked.length) return undefined
  let seen = new Set<string>()
  let peers: Hop[] = []
  for (let p of asked) {
    for (let h of p.peers ?? []) {
      let key = `${h.comp}.${h.prop}`
      if (seen.has(key)) continue
      seen.add(key)
      peers.push(h)
    }
  }
  let selected = asked.flatMap((p) => p.edge ? [p.edge] : [])
  let shapes = new Set(selected.map((s) => JSON.stringify(s)))
  if (shapes.size > 1) throw new Error('one edge rider cannot mix selectors')
  let select = selected[0]
  return { peers, ...(select ? { select } : {}) }
}

// A BOUNDED TRAVERSAL pred — `.reaches[requires,<=3]=T-42` — is a real filter,
// not a rider: it SELECTS the entities within a depth-capped transitive closure
// over one edge type. sql.ts compiles it to a recursive CTE over the indexed dep
// table; the JS matcher answers it from a `walk` that resolves the same closure
// once per query rather than per row.
export let REACHES = 'reaches'

// The traversal closures a pred list asks for, deduped — what a door precomputes
// before matching so the walk happens once, not per candidate row.
export let reachesOf = (preds: Pred[]): Pred[] =>
  preds.filter((p) => p.op == REACHES)

// Who reaches a traversal's target: the eids within `depth` edges of `value`,
// walking edge type `type` from child back to parent. One per query — every row
// then tests with a Set lookup.
export type Walk = (
  reach: { type: string; depth: number },
  target: string,
) => Set<string>

// A query addresses the LAZY entry partition when it names any session-log
// component (sessionComps) — `.entry.session`, `.generation.provider`,
// `.response.status`, and the rest. Those entities are omitted from the root
// snapshot, so a door reaches them only when the query OPTS IN by naming the
// partition; that is an explicit scope, not a silent boundary. Every query
// door reads this one predicate to decide whether entries are in its universe.
//
// A component-ABSENCE assertion (`p.prop == '' && p.op == ''`) does not opt in:
// it selects eager entities that LACK the comp, the opposite of wanting entries.
// kindPreds emits one per kindOrder-earlier comp, so `kind=comment` carries a
// synthetic `.entry absent` — without this guard it flipped every eager kind
// past `entry` into entry-partition mode and orderedEntries dropped every row.
// A positive reference (`.entry` EXISTS, `.entry.session=S-1`) still scopes in.
export let namesLazy = (preds: Pred[]) =>
  preds.some((p) => p.comp in sessionComps && !(p.prop == '' && p.op == ''))

// The sessions an entry query is scoped to — the eids of every scalar
// `.entry.session=` equality (a comma list is any-of). A range cannot name
// keyed partitions, so it stays unscoped and the bounded scan refines it.
// resolveRefs has already turned S-16765 into its eid by the time a door asks.
export let scopedSessions = (preds: Pred[]): string[] =>
  preds
    .filter((p) => p.comp == 'entry' && p.prop == 'session' && p.op == '')
    .flatMap((p) => p.value.includes('..') ? [] : p.value.split(','))
    .filter(Boolean)

// Quarantine is invisible by default, but mentioning the facet is the
// deliberate extra step that lets a list ask about it. This stays beside
// matchQuery rather than inside it: writers and keyed internals still need to
// reason about a row without silently changing the question they asked.
export let reveals = (preds: Pred[]) =>
  preds.some((p) => p.comp == 'quarantined' || leafOf(p).comp == 'quarantined')

export let listed = (comps: Comps, preds: Pred[]) =>
  !comps.quarantined || reveals(preds)

// The pred list a COMPILED membership statement should carry: the caller's
// filter plus the two universal screens a door otherwise applies in JS after
// the statement — quarantine (listed) and the lazy entry partition (namesLazy).
// Both are spelled as ordinary component-ABSENCE preds, so the existing
// compiler answers them from the same LEFT JOIN it gives any facet, and
// namesLazy's `.prop == '' && .op == ''` guard keeps the entry screen from
// reading as an opt-IN to the partition.
//
// Why it matters beyond tidiness: a JS filter that runs AFTER a statement's
// LIMIT under-fills the page, so a window can only be exact once the screens
// the answer depends on are inside the same statement. `search()` (db.ts) has
// unshifted the quarantine half by hand since before this existed.
let absent = (comp: string): Pred => ({ comp, prop: '', op: '', value: '' })
export let screened = (preds: Pred[], entries: boolean): Pred[] => [
  ...preds,
  ...reveals(preds) ? [] : [absent('quarantined')],
  ...entries ? [] : [absent('entry')],
]

// kind=K as a filter, not a JS screen. kindOf is "the first kindOrder
// component present", so kind=K is K present AND every earlier component
// absent — a synthetic Pred[] the SQL compiler answers from the index, where
// a lone kind= otherwise built the whole 27 MB snapshot to screen it in JS.
// The absence clauses are what make it EXACT: an entity wearing both `memory`
// and `comment` is a comment (comment is earlier), so kind=memory must skip
// it — presence (`.memory!`) cannot, and overcounts. null for a word naming
// no kind (kind=entity, a typo): the derived `entity` fallback is every
// kindOrder comp absent, and its only reader is the JS screen that stays.
export let kindPreds = (kind: string): Pred[] | null => {
  let i = kindOrder.indexOf(kind)
  if (i < 0) return null
  return [
    { comp: kind, prop: '', op: EXISTS, value: '' },
    ...kindOrder.slice(0, i).map((c) => ({
      comp: c,
      prop: '',
      op: '',
      value: '',
    })),
  ]
}

// A SCOPE is a virtual/derived prop: a named `(value) => Pred[]` resolver that
// folds into the AND-list and composes like any column filter — the
// ActiveRecord-scope shape, one filter grammar. `.kind=memory` is the first
// member: it resolves through kindPreds to the exact presence Pred[], which is
// why the bespoke `kind` parameter that threaded five layers is gone. A
// resolver returns null for a value it cannot name (`.kind=typo`); the pred
// seam turns that into the refusal any bad filter earns. Real column/component
// props resolve FIRST in pred(), so a scope never shadows `.status`/`.project`
// — and a scope name colliding with a real prop is a registration error,
// caught here at load rather than as a silent dead scope later.
export let scopes: Record<string, (value: string) => Pred[] | null> = {
  // kindWord folds the plural in (`.kind=projects` reads like `.kind=project`),
  // the leniency the bare-word listing already granted.
  kind: (value) => kindPreds(kindWord(value) ?? value),
}
for (let name in scopes) {
  if (owned(name)) throw new Error(`scope .${name} shadows a real prop`)
}

// `doc` sits in kindOrder as the fallback NAME for a bare document, but
// every kind wears one — so a doc pred is never the cross-kind mistake.
// Anything outside kindOrder (created, updated, recall) is a facet too.
let facet = (comp: string) => comp == 'doc' || !kindOrder.includes(comp)

// An empty result is the one moment a caller cannot tell INTERPRETATION
// from data. A pred naming another kind's column is perfectly valid, so it
// matches nothing and prints exactly like a truthful "none" — `.from=jeff`
// routes to mail.from and answers "no matches" for TASKS; `.to=holdco`
// routes to deliver.to (a reference, so the id sugar resolves holdco) and
// answers "none" for TASKS. Both were read as evidence of absence.
//
// So on empty — and only on empty — a door says how the filters actually
// routed. This reports what route() DID, never what COULD match: an entity
// may carry `task` and `mail` both and still be NAMED a task (kindOf takes
// the first component in kindOrder), so impossibility is not derivable and
// a refusal here would be a policy wearing a fact's clothes. Being advisory
// is what makes it safe to add: a legitimate "none" is unchanged.
export let resolution = (preds: Pred[], kind?: string) => {
  let crossed = preds.filter((p) =>
    p.op != ORDER && p.op != NEAR && p.op != AGG && !p.refs &&
    p.comp && p.comp != kind && !facet(p.comp)
  )
  // The suggestion is composed through the routing table, so it can only
  // name a spelling that parses — an error naming a door owes that much.
  let alt = (prop: string) => {
    let cols = (kind ? routes[kind] : undefined) ?? []
    return cols.includes(prop) ? `.${kind}.${prop}` : ''
  }
  return crossed
    .map((p) => {
      let mean = alt(p.prop)
      return `${p.comp}.${p.prop}${mean ? ` — did you mean ${mean}=?` : ''}`
    })
    .join(', ')
}

// A shared reference has no one owning component, but its type is still
// known: the vocabulary is searched by name. All other aims come straight
// from the vocabulary, including a path's far side.
let typed = (comp: string, prop: string): Prop | undefined => {
  let p = propAt(comp, prop)
  if (p) return p
  let type = !comp ? bareType(prop) : undefined
  return type ? { comp, prop, name: prop, type } : undefined
}

let kind = (p: Prop) =>
  typeof p.type == 'string'
    ? p.type
    : 'enum' in p.type
    ? 'enum'
    : 'eid' in p.type
    ? 'eid'
    : 'text'

// Time phrases stay authored: a saved `today` must advance tomorrow. span()
// validates that language without freezing it; every other scalar becomes its
// canonical comparison string through the same parser writes use.
let atom = (p: Prop, value: string): string => {
  if (!value) return value
  if (kind(p) == 'time' && span(value)) return value
  if (kind(p) == 'eid') {
    try {
      return String(parseProp(p, value))
    } catch {
      return value // aliases need the evaluator's graph
    }
  }
  return String(parseProp(p, value))
}

let range = (p: Prop, value: string): string => {
  let m = value.match(/^(.*?)\.\.(\.?)(.*)$/s)
  if (!m) return atom(p, value)
  let [, lo, excl, hi] = m
  return `${atom(p, lo)}..${excl ? '.' : ''}${atom(p, hi)}`
}

let typedValue = (p: Prop, value: string): string =>
  value.split(',').map((v) => range(p, v)).join(',')

// Dotted segments to the hops they name, applying ONE rule at each step: a
// segment that names a COMPONENT with another segment behind it is the explicit
// `comp.prop` spelling and eats two (.comment.target); anything else is a bare
// prop routed by name and eats one (.assignee). The final group is the leaf
// tested against op/value; every earlier group is a deref the caller checks is
// an `{eid}` column. So `.comment.target.doc.title` is [(comment,target)] then
// (doc,title), and `.assignee.title` is [(task,assignee)] then (doc,title) —
// one traversal, two spellings.
let groupsOf = (segs: string[]): Hop[] => {
  let out: Hop[] = []
  for (let i = 0; i < segs.length;) {
    // A component consumes its next segment as the explicit `comp.prop`
    // spelling; a component with nothing behind it is a bare facet (route()).
    if (routes[segs[i]] && i + 1 < segs.length) {
      let [a, b] = [segs[i], segs[i + 1]]
      if (!routes[a].includes(b)) throw new Error(`no such prop: .${a}.${b}`)
      out.push({ comp: a, prop: b })
      i += 2
    } else {
      // A bare word that isn't the final segment is a deref hop; an edge word
      // there is an edge-HOP (T-14078), never an {eid}-column deref.
      if (i + 1 < segs.length && edgeish.test(segs[i])) {
        throw new Error(EDGE_HOP(segs[i]))
      }
      out.push(route(segs[i]))
      i += 1
    }
  }
  return out
}

// A reverse hop: `.comments…`, where the FIRST segment names a reverse
// association (reverseAssocs). `.comments.created.by=P-19` keeps every parent
// with a child comment matching the sub-filter — ANY, the default. A `!` right
// after the association (before its `.`) negates the existence: `.comments!.author=jeff`
// is NONE by jeff, `.comments!.status!=done` is ALL done (De Morgan). A bare
// association is presence (`.comments!`, ≥1), absence (`.comments=`, 0), or a
// cardinality test (`.comments>=5`). null when the first segment is not a reverse
// association, so preds() falls through to the ordinary column/path grammar.
// The bang only binds when a `.` follows, so `.comments!=5` reads as a count.
let REV =
  /^\.([A-Za-z_]+)(!(?=\.))?((?:\.[A-Za-z_-]+)*)(!=|~=|<=|>=|<|>|=|!)(.*)$/s
let revHop = (token: string): Pred | null => {
  let m = token.match(REV)
  if (!m) return null
  let [, name, bang, sub, op, value] = m
  let assoc = reverseAssocs.get(name)
  if (!assoc) return null
  value = value.replace(/^"(.*)"$/s, '$1')
  let mk = (inner: Pred[], not: boolean, count?: boolean): Pred => ({
    comp: assoc!.comp,
    prop: assoc!.prop,
    op: count ? OPS[op] : EXISTS,
    value: count ? value : '',
    rev: {
      comp: assoc!.comp,
      prop: assoc!.prop,
      preds: inner,
      not,
      ...(count ? { count } : {}),
    },
  })
  if (sub) {
    // Existential with a sub-filter: op/value ride the sub-pred's leaf, which
    // preds() parses — recursively, so a nested hop composes off the child.
    let inner = preds('.' + sub.slice(1) + op + value)
    if (!inner) {
      throw new Error(`reverse filter needs a predicate: .${name}${sub}`)
    }
    return mk(inner, bang == '!')
  }
  if (op == '!' || (op == '~=' && !value)) return mk([], false) // present ≥1
  if (op == '=' && !value) return mk([], true) // none (0)
  if (!/^\d+$/.test(value)) {
    throw new Error(
      `.${name} needs a sub-path (.${name}.<prop>) or a count (.${name}>=N)`,
    )
  }
  return mk([], false, true) // cardinality: count <op> value
}

// One filter token to the preds it contributes. A scalar filter is one pred; a
// SCOPE (`.kind=memory`) expands to the Pred[] it splices into the AND-list —
// the wrinkle that once made kind a bespoke parameter, resolved here so a
// virtual prop reads exactly like a column. A reverse hop (`.comments…`) resolves
// first, above the column grammar. null: the token is no dot-param at all (a bare
// word, an opless `.env`) — a text term to whoever parses the line.
//
// A hyphen is admitted into the NAME so a hyphenated spelling reaches route()
// and earns the same refusal writes give it (client.ts param()). No column is
// hyphenated, so nothing new routes — but before this, '.blocked-by=T-1' failed
// the pattern and fell through to a bare TEXT term, silently searching for the
// filter the caller thought they wrote.
// `.reaches[requires,<=3]=T-42` — the bracket carries what a dot-param cannot:
// WHICH edge type to walk and HOW FAR. The cap is required by the shape itself,
// so an unbounded closure has no spelling to be refused later. Matched before
// the dot-param pattern, which stops at the '['.
let REACH = /^\.reaches\[([A-Za-z_]+)\s*,\s*<=\s*(\d+)\]=(.*)$/s
let EDGE_SELECT =
  /^\.edges\[([A-Za-z_]+)(?:\s*,\s*([A-Za-z_-]+(?:\.[A-Za-z_-]+)*))?\]!$/s

export let preds = (token: string): Pred[] | null => {
  // Any `.reaches[…` spelling answers HERE, right or wrong: a malformed one that
  // fell through would not match the dot-param pattern either and would end up a
  // bare TEXT term, silently searching for the traversal the caller thought they
  // wrote (the hyphen lesson below, same trap).
  if (token.startsWith('.reaches[') && !owned('reaches')) {
    let reach = token.match(REACH)
    let [, type, depth, value] = reach ?? []
    if (!reach || !value) {
      throw new Error(
        '.reaches names an edge type, a depth cap and an entity: ' +
          '.reaches[requires,<=3]=T-42',
      )
    }
    if (!(edges as readonly string[]).includes(type)) {
      throw new Error(
        `.reaches walks an edge type (${edges.join(', ')}) — not ${type}`,
      )
    }
    if (Number(depth) < 1) {
      throw new Error(`.reaches needs at least one hop: got <=${depth}`)
    }
    return [{
      comp: '',
      prop: '',
      op: REACHES,
      value,
      reach: { type, depth: Number(depth) },
    }]
  }
  // `.edges[referenced,entry.session]!` — select one STORED dependency type
  // and optionally project either endpoint through one `{eid}` column. The
  // member set is tested after projection, so a Session selects the referenced
  // edges owned by its entries without selecting or enumerating those entries.
  if (token.startsWith('.edges[') && !owned('edges')) {
    let selected = token.match(EDGE_SELECT)
    let [, type, raw] = selected ?? []
    if (!selected || !(edges as readonly string[]).includes(type)) {
      throw new Error(
        `.edges selects one edge type (${edges.join(', ')}) and an optional ` +
          'endpoint reference: .edges[referenced,entry.session]!',
      )
    }
    let via: Hop | undefined
    if (raw) {
      let groups = groupsOf(raw.split('.'))
      via = groups[groups.length - 1]
      if (groups.length > 1 || !via.prop || !isRef(via.comp, via.prop)) {
        throw new Error(
          `.edges endpoint projection must be one {eid} column: ${raw}`,
        )
      }
    }
    return [{
      comp: '',
      prop: '',
      op: EDGES,
      value: '',
      peers: [],
      edge: { type, ...(via ? { via } : {}) },
    }]
  }
  let r = revHop(token)
  if (r) return [r]
  let m = token.match(
    /^\.([A-Za-z_-]+(?:\.[A-Za-z_-]+)*)(!=|~=|<=|>=|<|>|=|!)(.*)$/s,
  )
  if (!m) return null
  let [, path, op, value] = m
  let segs = path.split('.')
  if (op == '!' && value) {
    throw new Error(`presence filters end at !: .${path}!`)
  }
  // a quoted value is the escape hatch for spaces where whitespace splits
  value = value.replace(/^"(.*)"$/s, '$1')
  if (path == 'order' && op == '=') {
    return [{ comp: '', prop: 'order', op: ORDER, value }]
  }
  if (path == 'near' && op == '=') {
    return [{ comp: '', prop: 'near', op: NEAR, value }]
  }
  // `.refs=T-3` — the multi-column reverse-union (this entity's backlinks of
  // T-3). Presence/absence read like a reverse association: `.refs!` references
  // something, `.refs=` references nothing. The value resolves like any id at
  // delivery (resolveRefs). Guarded so a future `refs` column would win.
  if (path == 'refs' && !owned('refs')) {
    if (op == '=') return [{ comp: '', prop: '', op: '', value, refs: true }]
    if (op == '!') {
      return [{ comp: '', prop: '', op: EXISTS, value: '', refs: true }]
    }
    throw new Error(
      '.refs takes an id (.refs=T-3), presence (.refs!) or absence (.refs=)',
    )
  }
  // `.count!` — the plainest aggregate: how many entities the REST of the line
  // selects, a number rather than a row set. It names no column, which is the
  // whole difference from `.tally=`, so PRESENCE is the only spelling it takes.
  //
  // The vocabulary already owns a bare `count` (recall.count), so this claims
  // exactly one spelling and leaves the rest: `.count>3` still filters that
  // column, and `.recall.count!` still says the presence test this bare form
  // used to mean. A directive winning a bare spelling outright would silently
  // change what a saved board asks.
  if (path == 'count' && op == '!') {
    return [{ comp: '', prop: '', op: AGG, value: '', agg: 'count' }]
  }
  // `.distinct=domain` / `.tally=domain` — an aggregate PROJECTION over one
  // column, not a filter. Its column routes like any bare prop (or the explicit
  // `.distinct=task.domain`); a path is refused — the census aggregates a single
  // column. aggOf()/aggregateSql() read the AGG pred; matchQuery lets it through.
  if ((path == 'distinct' || path == 'tally') && !owned(path)) {
    if (op != '=' || !value) {
      throw new Error(`.${path} names a column: .${path}=domain`)
    }
    let groups = groupsOf(value.split('.'))
    let at = groups[groups.length - 1]
    if (groups.length > 1 || !at.prop) {
      throw new Error(
        `.${path} aggregates one column, not a path: .${path}=${value}`,
      )
    }
    return [{ comp: at.comp, prop: at.prop, op: AGG, value: '', agg: path }]
  }
  // `.fields=pin.x,pin.y,pin.z~` — a PROJECTION, not a filter: the columns each
  // result row carries beyond its eid, so a partial-cache subscription reads live
  // values without holding the whole graph. A trailing `~` marks a column
  // VOLATILE — projected but EXCLUDED from the change-signal, so a churny field (a
  // pin's z, bumped on every toFront) delivers its value yet never re-fires the
  // query. Each column routes like a bare prop (or its explicit `pin.x`); a path
  // is refused — a projection reads one entity's own columns. Guarded so a future
  // `fields` column would win. fieldsOf()/select() read the PROJECT pred.
  //
  // `.fields=eid` is the EIDS-ONLY form: an empty projection, so a result row
  // carries its spine and nothing else. It is spelled as a column because that
  // is what it is — every row already carries `eid`, so naming it and nothing
  // beside it says "the ids, no columns". An empty `.fields=` stays a refusal:
  // a caller who wrote no columns meant to write some.
  if (path == 'fields' && !owned('fields')) {
    if (op != '=' || !value) {
      throw new Error('.fields names columns: .fields=pin.x,pin.y')
    }
    if (value == 'eid') {
      return [{ comp: '', prop: '', op: PROJECT, value: '', fields: [] }]
    }
    let fields = value.split(',').map((seg): Field => {
      let wake = !seg.endsWith('~')
      let groups = groupsOf((wake ? seg : seg.slice(0, -1)).split('.'))
      let at = groups[groups.length - 1]
      if (groups.length > 1 || !at.prop) {
        throw new Error(`.fields projects columns, not paths: .fields=${seg}`)
      }
      return { comp: at.comp, prop: at.prop, wake }
    })
    return [{ comp: '', prop: '', op: PROJECT, value: '', fields }]
  }
  // `.limit=200` / `.after=13882` — the WINDOW, a bound on the answer rather
  // than a filter on its members. `limit` is how many of the newest matches to
  // answer with; `after` continues that window below a spine num, so paging a
  // board is `.limit=200` then `.limit=200&.after=<the last num you got>`.
  // Both take a non-negative integer and nothing else: a window whose bound is
  // a guess is worse than none, so a bad one is refused rather than dropped.
  // Guarded so a future `limit`/`after` column would win the spelling.
  if ((path == 'limit' || path == 'after') && !owned(path)) {
    if (op != '=' || !/^\d+$/.test(value)) {
      throw new Error(`.${path} takes a whole number: .${path}=200`)
    }
    let win: Win = path == 'limit'
      ? { limit: Number(value) }
      : { after: Number(value) }
    return [{ comp: '', prop: '', op: WINDOW, value, win }]
  }
  // `.edges!` / `.edges.peers=status,title` — the RIDER, not a filter: deliver the
  // dep triples incident to whatever the other preds select, and optionally the
  // far endpoint's named columns beside them. This is what replaces shipping every
  // edge in the graph at boot: edges arrive scoped to a result set, like rows.
  // Each peer column routes like a bare prop (or its explicit `task.status`); a
  // path is refused — a peer projection reads one entity's own columns. Guarded so
  // a future `edges` column would win. edgeRider() reads the directive.
  if (segs[0] == 'edges' && !owned('edges')) {
    if (segs.length == 1 && op == '!' && !value) {
      return [{ comp: '', prop: '', op: EDGES, value: '', peers: [] }]
    }
    if (segs.length == 2 && segs[1] == 'peers' && op == '=' && value) {
      let peers = value.split(',').map((seg): Hop => {
        let groups = groupsOf(seg.split('.'))
        let at = groups[groups.length - 1]
        if (groups.length > 1 || !at.prop) {
          throw new Error(
            `.edges.peers projects columns, not paths: .edges.peers=${seg}`,
          )
        }
        return at
      })
      return [{ comp: '', prop: '', op: EDGES, value: '', peers }]
    }
    throw new Error(
      '.edges rides a query (.edges!) and may project the far endpoint ' +
        '(.edges.peers=status,title)',
    )
  }
  // A SCOPE resolves a virtual prop to the Pred[] it splices into the AND-list.
  // Real props win: `owned` names a prop a column/component already routes, so
  // only an unowned single-segment scope name reaches here and `.status` keeps
  // its spelling. The resolver reads the value and returns null for one it
  // cannot name (`.kind=typo`), refused like any bad filter.
  if (segs.length == 1 && segs[0] in scopes && !owned(segs[0])) {
    let out = scopes[segs[0]](value)
    if (!out) throw new Error(`no such ${segs[0]}: ${value || '(empty)'}`)
    return out
  }
  let p: Pred
  // A trailing bang completes a component sentence. This must win over a
  // same-named column (`persona` is both a facet and a session reference);
  // the column's explicit spelling remains `.session.persona!`.
  if (segs.length == 1 && !value && op == '!' && segs[0] in routes) {
    p = { comp: segs[0], prop: '', op: OPS[op], value }
  } else {
    let groups = groupsOf(segs)
    let leaf = groups[groups.length - 1]
    let derefs = groups.slice(0, -1)
    for (let d of derefs) {
      if (!isRef(d.comp, d.prop)) {
        throw new Error(
          `.${
            d.prop || d.comp
          } is not a reference — paths walk reference columns`,
        )
      }
    }
    p = derefs.length
      ? {
        comp: derefs[0].comp,
        prop: derefs[0].prop,
        op: OPS[op],
        value,
        at: [...derefs.slice(1), leaf],
      }
      : { comp: leaf.comp, prop: leaf.prop, op: OPS[op], value }
  }
  if (!p.prop) {
    if (p.value || (p.op != '' && p.op != '~' && p.op != EXISTS)) {
      throw new Error(
        `component filters are presence tests: .${p.comp}= is absent, ` +
          `.${p.comp}! is present`,
      )
    }
    return [p]
  }
  // Contains is deliberately literal. Absence has no scalar atom. Every
  // other form parses each scalar/list/range atom against the leaf
  // property's type before a row is scanned.
  let type = typed(leafOf(p).comp, leafOf(p).prop)
  if (type && p.op != '~' && p.value != '') {
    p.value = typedValue(type, p.value)
  }
  return [p]
}

// One scalar pred, or null — the door for writes' param check and unit
// assertions, where a token names a single filter. A multi-pred SCOPE belongs
// in a filter LIST (preds() is that door); this returns the scope's first pred.
export let pred = (token: string): Pred | null => {
  let out = preds(token)
  return out ? out[0] : null
}

// The rejection every strict door throws when preds() shrugs: the error is the
// teaching moment, so it names where a stray predicate lives — a bare `kind=K`
// is the warm mistake, and the door says the dotted spelling that now works —
// and sketches the dot-param shape (FILTERS in grammar.ts spells the operators).
export let noFilter = (f: string) =>
  `not a filter: ${f} — ${
    f.startsWith('kind=') ? `write it dotted: .${f}; ` : ''
  }${SKETCH}`

// A bare word: an FTS5 term over doc title/body. comp/prop are for show —
// matchQuery treats TEXT specially (one pred, two columns).
export let TEXT = 'text'
let text = (value: string): Pred => ({
  comp: 'doc',
  prop: '*',
  op: TEXT,
  value,
})

// The safe MATCH spelling shared by ranked retrieval and the membership SQL.
// User text is always a quoted phrase, never FTS operator syntax; only a
// trailing `*` has grammar meaning and prefix-matches the phrase's final token.
export let ftsTerm = (value: string): string => {
  let prefix = /\*+$/.test(value)
  let phrase = value.replace(/\*+$/, '').replaceAll('"', '').trim()
  return phrase ? `"${phrase}"${prefix ? '*' : ''}` : ''
}

export let ftsQuery = (preds: Pred[]): string =>
  preds.filter((p) => p.op == TEXT).map((p) => ftsTerm(p.value))
    .filter(Boolean).join(' ')

// TEXT may sit inside a reverse association's child filter. A client without
// SQLite must treat the WHOLE query as server-owned rather than locally
// approximating only the top-level terms.
export let textual = (preds: Pred[]): boolean =>
  preds.some((p) => p.op == TEXT || !!p.rev && textual(p.rev.preds))

// TEXT membership belongs to SQLite's unicode61 tokenizer. Callers with no
// graph index cannot safely approximate it in JavaScript; they match no text
// until an indexed answer arrives rather than inventing a wider membership.
export type Fts = (eid: string, pred: Pred) => boolean

// The '&' split, quote-aware: a quoted run is ONE value even when it
// carries the separator. Quotes already glue a value across whitespace;
// they glue it across '&' for the same reason, and the case that forced
// it is the one a page address makes ordinary — `.web.url="https://x/p
// ?a=1&b=2"` is a single predicate, where unquoted it silently became a
// url pred plus a stray text term that matched nothing. An unbalanced
// quote never matches the quoted branch, so it splits exactly as before.
let segments = (q: string) => q.match(/(?:"[^"]*"|[^&])+/g) ?? []

// A query string to preds. '&' separates first (an &-segment that IS one
// dot-param keeps its spaces — the old grammar); a segment holding ` .`
// or bare words splits on whitespace, quotes glue: that's how a search
// box mixes terms and filters in one line.
//
// Empty: matches NOTHING. An empty query has selected nothing, so there is
// nothing to return — the never-pred below compiles to a false SQL condition
// and fails matchQuery, so every door (subs, boards, /query, MCP, CLI)
// answers the empty set cheaply. The old empty-means-everything default was
// how one blank board query staged the whole graph onto a socket. A caller
// that means "all of a kind" states it: `.task!`, `.memory!`.
export let NEVER = 'never'
export let never = (): Pred => ({ comp: '', prop: '', op: NEVER, value: '' })
export let parseQuery = (q: string): Pred[] => {
  let out = segments(q).map((t) => t.trim()).filter(Boolean).flatMap((seg) => {
    if (seg.startsWith('.') && !/\s\./.test(seg)) {
      let p = preds(seg) // null = an opless dot-word (.env) — a term
      if (p) return p
    }
    return (seg.match(/[^\s"]+"[^"]*"|"[^"]*"|\S+/g) ?? []).flatMap((tok) => {
      if (tok.startsWith('.')) {
        let p = preds(tok)
        if (p) return p
      }
      return [text(tok.replace(/^"(.*)"$/s, '$1'))]
    })
  })
  return out.length ? out : [never()]
}

let asNum = (v: unknown) =>
  typeof v == 'number'
    ? v
    : /^-?\d+(\.\d+)?$/.test(String(v))
    ? Number(v)
    : null

// v vs s, numerically when both sides are numbers, else as strings.
let cmp = (v: unknown, s: string) => {
  let n = asNum(v), m = asNum(s)
  return n != null && m != null
    ? Math.sign(n - m)
    : String(v) < s
    ? -1
    : String(v) > s
    ? 1
    : 0
}

// The '=' forms: '' is null/absent, 'a,b' any-of, 'x..y' a range.
let eq = (v: unknown, value: string): boolean => {
  if (value == '') return v == null || v === ''
  let r = value.match(/^(.*?)\.\.(\.?)(.*)$/s)
  if (r) {
    if (v == null) return false
    let [, lo, excl, hi] = r
    return cmp(v, lo) >= 0 && (excl ? cmp(v, hi) < 0 : cmp(v, hi) <= 0)
  }
  if (value.includes(',')) {
    return value.split(',').some((part) => eq(v, part))
  }
  return String(v) == value
}

// A timestamp against a time phrase: the phrase names a range, the op
// picks its edge — = within, >= from the start, <= until the end, > and <
// strictly outside. Only time-typed columns take this road (a domain
// literally named 'today' stays text).
let inTime = (v: string, p: Pred, s: Span): boolean => {
  let t = Date.parse(v)
  switch (p.op) {
    case '':
      return t >= s.start && (t < s.end || t == s.start)
    case '!':
      return !(t >= s.start && (t < s.end || t == s.start))
    case '<':
      return t < s.start
    case '<=':
      return t < s.end || t == s.start
    case '>':
      return t >= s.end && t != s.start
    default: // >=
      return t >= s.start
  }
}

let test = (v: unknown, p: Pred, now?: number): boolean => {
  if (p.op == EXISTS) return v != null
  let target = leafOf(p)
  let type = typed(target.comp, target.prop)
  if (p.op != '~' && type && kind(type) == 'time' && typeof v == 'string') {
    let spans = p.value.split(',').map((value) => span(value, now))
    if (spans.every((s) => s)) {
      let hit = spans.some((s) => inTime(v, { ...p, op: '' }, s!))
      if (p.op == '' || p.op == '!') return p.op == '' ? hit : !hit
    }
    let s = span(p.value, now)
    if (s) return inTime(v, p, s)
  }
  switch (p.op) {
    case '':
      return eq(v, p.value)
    case '!':
      return !eq(v, p.value)
    case '~':
      return String(v ?? '').toLowerCase().includes(p.value.toLowerCase())
    default: // < <= > >=
      if (v == null) return false
      return p.op == '<'
        ? cmp(v, p.value) < 0
        : p.op == '<='
        ? cmp(v, p.value) <= 0
        : p.op == '>'
        ? cmp(v, p.value) > 0
        : cmp(v, p.value) >= 0
  }
}

// The sugar's other half: a board-stored query carries values as typed
// ('jeff', 'T-3') — the door resolvers never saw it, so whoever EVALUATES
// resolves, against whatever graph they hold. Only reference columns with
// equality-shaped ops resolve; each part of an any-of list resolves
// alone; a miss stays as typed and matches nothing, because a board
// mid-render is no place to throw.
export let resolveRefs = (
  preds: Pred[],
  lookup: (id: string) => string | undefined,
): Pred[] =>
  preds.map((p) => {
    // A multi-column reverse-union's value is an id like any reference — but it
    // owns no comp/prop to type it, so resolve it through the entity target. A
    // traversal's target is the same shape: one entity, no column to type it.
    if (p.refs || p.op == REACHES) {
      if ((p.op != '' && p.op != REACHES) || !p.value) return p
      try {
        let value = String(parseProp(REFS_PROP, p.value, { resolve: lookup }))
        return value == p.value ? p : { ...p, value }
      } catch {
        return p
      }
    }
    // A reverse hop's own value is a count, never a ref — but its sub-filter
    // carries the same typed values, so resolve THROUGH it (recursively).
    if (p.rev) {
      let inner = resolveRefs(p.rev.preds, lookup)
      return inner == p.rev.preds
        ? p
        : { ...p, rev: { ...p.rev, preds: inner } }
    }
    let { comp, prop: target } = leafOf(p)
    if (!isRef(comp, target) || (p.op != '' && p.op != '!')) return p
    if (!p.value || /\.\./.test(p.value)) return p
    let type = typed(comp, target)
    if (!type) return p
    let value = p.value.split(',')
      .map((part) => {
        if (!part) return part
        try {
          return String(parseProp(type, part, { resolve: lookup }))
        } catch {
          return part // a live saved query may name an entity not here yet
        }
      })
      .join(',')
    return value == p.value ? p : { ...p, value }
  })

// Does an entity satisfy every pred? A TEXT pred reads the doc itself —
// one pred, either column. A path pred dereferences through `ent` (the
// evaluator's graph), folding hop after hop; no ent, no ref, or no target
// anywhere along the chain reads as an absent value — so `.assignee.title=x`
// (and `.comment.target.doc.title=x`) misses and `!=x` holds, same as any
// null column.
//
// `now` is the clock a time phrase reads. It defaults to the wall clock,
// which is what every door wants — a saved `today` must advance tomorrow.
// It is a parameter because a moving phrase names a window the clock moves
// THROUGH, so the only way to state "this row has aged out" as a test is to
// hand the matcher a later moment (see the subscription sweep).
// A bare component name (empty prop) is a presence test: `!`/`~=` hold when the
// bag wears the component, `=` when it does not — the same rule at depth 0 and
// at a path leaf (`.blocked!` and `.task.project.archived!` mean the same thing
// one hop apart). A broken link hands in an undefined bag, which reads as absent.
let present = (bag: Comps | undefined, comp: string, op: string): boolean =>
  op == '~' || op == EXISTS ? !!bag?.[comp] : !bag?.[comp]

// The reverse-hop accessor: the children whose `comp.prop` reference equals
// `eid`, as their component bags. The mirror of `ent` (forward deref) — a caller
// with a reverse index (live's index.ts refs, a server snapshot) supplies it; a
// caller without one leaves reverse hops matching nothing (the null reading, the
// same graceful absence a missing `ent` gives a forward path).
export type Kids = (
  eid: string,
  comp: string,
  prop: string,
) => (Comps | undefined)[]

// A Kids accessor over an in-memory universe (a byEid map). Lazily builds and
// caches the reverse map for each ref column a hop asks about, so a caller that
// holds the whole graph (the server's snapshot fallback, mcp, tests) answers a
// reverse hop the same way the live index and the SQL EXISTS do — one door, no
// per-caller reverse index. Generic over the row so a Map<eid, comps> of any
// exact shape passes without the Map-variance friction.
export let kidsOf = <
  R extends Record<string, Record<string, unknown> | undefined>,
>(byEid: Map<string, R>): Kids => {
  let cache = new Map<string, Map<string, string[]>>()
  return (eid, comp, prop) => {
    let key = `${comp}.${prop}`
    let m = cache.get(key)
    if (!m) {
      m = new Map()
      for (let [ce, cc] of byEid) {
        let v = cc[comp]?.[prop]
        if (v == null) continue
        let k = String(v)
        m.set(k, [...(m.get(k) ?? []), ce])
      }
      cache.set(key, m)
    }
    return (m.get(eid) ?? []).map((k) => byEid.get(k))
  }
}

// An entity's own eid, read off any component bag it wears (every bag carries
// `eid`, readable's first column). A reverse hop needs it to ask "who points at
// ME"; the forward grammar never did, so matchQuery never took it as an argument.
let eidOf = (c: Comps): string | undefined => {
  let e = c.entity?.eid
  if (e != null) return String(e)
  for (let k in c) {
    let v = c[k]?.eid
    if (v != null) return String(v)
  }
}

// A child count against the outer op/value — the cardinality half of a reverse
// hop. Mirrors test()'s comparison ops; '' is '=', '!' is '!='.
let cmpCount = (n: number, op: string, value: string): boolean => {
  let m = Number(value)
  return op == ''
    ? n == m
    : op == '!'
    ? n != m
    : op == '<'
    ? n < m
    : op == '<='
    ? n <= m
    : op == '>'
    ? n > m
    : n >= m
}

export let matchQuery = (
  c: Comps,
  preds: Pred[],
  ent?: (eid: string) => Comps | undefined,
  now?: number,
  kids?: Kids,
  walk?: Walk,
  fts?: Fts,
) =>
  preds.every((p) => {
    if (p.op == NEVER) return false // the empty query: selects nothing
    if (
      p.op == ORDER || p.op == NEAR || p.op == AGG || p.op == PROJECT ||
      p.op == EDGES
    ) {
      return true
    }
    // A window bounds the ANSWER, never membership: every match still matches,
    // and the door that answers is what cuts the page.
    if (p.op == WINDOW) return true
    if (p.op == REACHES) {
      // The bounded closure, resolved ONCE per query by the caller's walk and
      // tested here with a Set lookup — never a per-row traversal. No walk means
      // no closure, the same reading a reverse hop gives a missing accessor.
      let self = eidOf(c)
      return !!self && !!walk && !!p.reach && walk(p.reach, p.value).has(self)
    }
    if (p.refs) {
      // The multi-column reverse-union: read every {eid} column this bag
      // carries. `.refs=X` holds when any equals X; `.refs!` when any is set;
      // `.refs=` when none is — the same tri-state a reverse association marks.
      let vals = refCols
        .map(([comp, prop]) => c[comp]?.[prop])
        .filter((v) => v != null)
      if (p.op == EXISTS) return vals.length > 0
      if (p.value == '') return vals.length == 0
      return vals.some((v) => String(v) == p.value)
    }
    if (p.op == TEXT) {
      let self = eidOf(c)
      return !!self && !!fts && fts(self, p)
    }
    if (p.rev) {
      // The reverse hop: resolve the children pointing back at me, then collapse
      // the many to a yes/no — a count comparison, or ANY child matching the
      // sub-filter (`not` flips that to NONE). No accessor → no children.
      let self = eidOf(c)
      let children = self && kids ? kids(self, p.rev.comp, p.rev.prop) : []
      if (p.rev.count) return cmpCount(children.length, p.op, p.value)
      let hit = children.some((k) =>
        !!k && matchQuery(k, p.rev!.preds, ent, now, kids, walk, fts)
      )
      return p.rev.not ? !hit : hit
    }
    if (!p.prop) return present(c, p.comp, p.op)
    if (p.at) {
      // Deref the near ref, then every intermediate hop, carrying the set of
      // component-bags forward; test the leaf on each. A broken link yields one
      // absent bag so absence tests still hold — the null-column reading.
      let hops = [{ comp: p.comp, prop: p.prop }, ...p.at.slice(0, -1)]
      let leaf = p.at[p.at.length - 1]
      let bags: (Comps | undefined)[] = [c]
      for (let h of hops) {
        bags = bags.flatMap((b) =>
          reads(b ?? {}, h.comp, h.prop).map((ref) =>
            ref != null ? ent?.(String(ref)) : undefined
          )
        )
      }
      // A leaf with no prop is a component-presence test on the far entity —
      // the depth-0 grammar one hop out, not a null column read that always fails.
      return bags.some((b) =>
        leaf.prop
          ? reads(b ?? {}, leaf.comp, leaf.prop).some((value) =>
            test(value, p, now)
          )
          : present(b, leaf.comp, p.op)
      )
    }
    return reads(c, p.comp, p.prop).some((value) => test(value, p, now))
  })

// One column read. A shared route has no component, so reads() below tests
// every component carrying that property; an entity may wear several.
//
// `updated.at` falls back to `created.at`, because the `updated` row is only
// stamped by a LATER write: an entity made and never touched since carries
// `created` and no `updated` at all. 1,656 of the graph's 10,767 entities are
// in that state, and every one of them was invisible to `.updated.at>=…` —
// including the two boards whose whole job is showing recent activity, which
// silently omitted anything filed and not revisited. Being made IS the last
// time a thing changed, so this is what the column already meant.
//
// Only `at`. Whether `.updated.by` should name the creator of an untouched
// entity is a different question about authorship, and nothing is broken by
// leaving it alone.
let read = (c: Comps, comp: string, prop: string): unknown => {
  // The one DERIVED column (D-24102): task.status is computed from the
  // completed/cancelled/claim comps, never stored — the same value statusOf
  // gives every renderer, so a filter, projection or tally reads it identically.
  if (comp == 'task' && prop == 'status') {
    return c.task ? statusOf(c) : undefined
  }
  let v = c[comp]?.[prop]
  return v == null && comp == 'updated' && prop == 'at' ? c.created?.at : v
}

let reads = (c: Comps, comp: string, prop: string): unknown[] => {
  if (comp) return [read(c, comp, prop)]
  let values = Object.values(c).map((v) => v?.[prop])
    .filter((v) => v != null)
  return values.length ? values : [undefined]
}

// The warmth of an entity, on (0,1] — the rank behind '.order=hot'.
// Recall aggregates (count, first_at, last_at) are the whole model:
// every recall earns a day of STABILITY, and spacing multiplies it —
// the same count spread over months buys more durability than an
// afternoon of cramming (mean interval, in weeks, is the multiplier).
// The score decays exponentially past last_at against that stability,
// so top-of-mind-for-hours / recallable-for-days / rings-a-bell-for-
// months fall out of one curve. No recall row yet: the entity's own last
// touch (updated.at, else created.at) counts as a single touch — new
// things start hot and fade
// unless used. The clock rides in as a parameter (tests fix it), and no
// stored score exists anywhere to sweep.
let DAY = 86_400_000
export let hot = (c: Comps, now: number): number => {
  let r = c.recall
  let count = Number(r?.count ?? 0)
  let last = Date.parse(String(r?.last_at ?? ''))
  if (!count || Number.isNaN(last)) {
    count = 1
    last = Date.parse(
      String(c.updated?.at ?? c.created?.at ?? ''),
    )
    if (Number.isNaN(last)) return 0
  }
  let first = Date.parse(String(r?.first_at ?? ''))
  if (Number.isNaN(first)) first = last
  let mean = count > 1 ? Math.max(0, last - first) / (count - 1) : 0
  let stability = DAY * count * (1 + mean / (7 * DAY))
  return Math.exp(-Math.max(0, now - last) / stability)
}

// Retirement is a damper, not an eraser: a retired project — and every
// task filed under it — keeps its whole recall curve but sinks beneath
// live work wherever warmth ranks (.order=hot, the digest). The lookup
// is the same comps fetcher matchQuery's path preds ride, so every
// caller already holds one.
export let SUNK = 0.1
// The far arm — a task whose PROJECT is archived — is a forward deref
// (task → its project → that project's archived stamp), so it IS the traversal
// grammar. `.archived.at` is the canonical presence spelling: the column is
// not-null, and db.ts rewrites `.retired_at` to it. The self arm (this row IS
// an archived project) has no ref to deref, so it stays a direct test.
let SUNK_PROJECT = parseQuery('.task.project.archived.at!')
export let sunk = (
  c: Comps,
  ent?: (eid: string) => Comps | undefined,
): boolean => (!!c.project && !!c.archived) || matchQuery(c, SUNK_PROJECT, ent)
export let warm = (
  c: Comps,
  now: number,
  ent?: (eid: string) => Comps | undefined,
) => hot(c, now) * (sunk(c, ent) ? SUNK : 1)

// The values a row must carry to satisfy the query's scalar equalities on
// one component — what a board drop patches, so a dropped task JOINS the
// board it landed on. Lists, ranges and comparisons pin nothing down.
export let adopt = (preds: Pred[], comp: string) => {
  let out: Record<string, string | number> = {}
  for (let p of preds) {
    if (p.comp != comp || p.op != '' || p.value == '') continue
    if (p.value.includes(',') || /\.\./.test(p.value)) continue
    out[p.prop] = /^-?\d+(\.\d+)?$/.test(p.value) ? Number(p.value) : p.value
  }
  return out
}

// ---- completion ----

// The vocabulary teaching at the point of typing: complete() takes the
// dot-token under the caret and returns candidates, each labeled with
// where it comes from — its comp, '· stamped' when filterable but
// server-owned, the op's meaning, the enum's prop. Pure over the routing
// table plus the caller's parameters (wells are the browser's suggestion
// lists, passed in), so one function serves the palette, the query
// editor, and every filter bar, and a table test can pin each segment.
export type Cand = { text: string; kind: string }

// op → its one-word meaning: the time doc's words (a phrase names a
// range, the op picks its edge), which read fine for scalars too.
let OP_WORDS: [string, string][] = [
  ['=', 'equals'],
  ['!', 'exists'],
  ['!=', 'not'],
  ['~=', 'contains'],
  ['<', 'before'],
  ['<=', 'until'],
  ['>', 'after'],
  ['>=', 'since'],
]

// a taste of the time grammar for *_at columns — hyphen-glued so a
// candidate stays one token in a whitespace-split line
let TIMES = [
  'today',
  'yesterday',
  'this-week',
  'last-week',
  'this-month',
  '1-hour-ago',
  '7-days-ago',
]

let starts = (s: string, pre: string) =>
  s.toLowerCase().startsWith(pre.toLowerCase())

// a column's label: its comp, marked when it's filterable but never
// wire-writable (in routes via `stamped`, absent from comps)
let mark = (c: string, p: string) =>
  comps[c]?.[p] || derivedProps[c]?.[p] ? c : `${c} · stamped`

let typeOf = (comp: string, prop: string) => typed(comp, prop)?.type

let tryRoute = (p: string) => {
  try {
    return route(p)
  } catch {
    return null
  }
}

// Every unique prop and every shared reference has a bare completion.
let bares = (): Cand[] => {
  let owners = new Map<string, string[]>()
  for (let [c, cols] of Object.entries(routes)) {
    if (c in sessionComps) continue
    for (let p of cols) owners.set(p, [...owners.get(p) ?? [], c])
  }
  let out: Cand[] = []
  for (let [p, cs] of owners) {
    if (edgeish.test(p)) continue
    let writable = cs.filter((c) => p in (comps[c] ?? {}))
    // A DERIVED prop (task.status) reads like a stored column but owns no wire
    // column, so it has no `writable` owner — route it to its declaring comp so
    // `.status` is still offered from a bare `.`, the way pred() resolves it.
    let derived = cs.filter((c) => p in (derivedProps[c] ?? {}))
    let routed = writable.length ? writable : derived.length ? derived : cs
    if (
      routed.length == 1 || sessionTwin(routed) || sharedRef(p, routed)
    ) {
      out.push({
        text: `.${p}`,
        kind: isRef('', p)
          ? routed.length == 1 ? `${routed[0]} · ref` : 'ref'
          : mark(routed[0], p),
      })
    }
  }
  return out.sort((a, b) => a.text.localeCompare(b.text))
}

// after a complete prop: the operators, plus the range skeleton
let opsFor = (base: string): Cand[] => [
  ...OP_WORDS.map(([op, kind]) => ({ text: base + op, kind })),
  { text: base + '=..', kind: 'range' },
]

let presenceOps = (base: string): Cand[] => [
  { text: base + '=', kind: 'absent' },
  { text: base + '!', kind: 'present' },
  { text: base + '~=', kind: 'present' },
]

// which column a whole dotted path's LEAF names — the same resolution pred()
// does, silent instead of thrown (mid-keystroke is no place to error). null
// when a non-leaf hop isn't a reference, so the value can't be completed.
let aimPath = (path: string): Hop | null => {
  try {
    let g = groupsOf(path.split('.'))
    if (g.slice(0, -1).some((d) => !isRef(d.comp, d.prop))) return null
    return g[g.length - 1]
  } catch {
    return null
  }
}

// An entity a reference could name: its human id and kind. The caller's list
// (the resident graph), so a `{eid}` param completes to real entities filtered
// by the kind the declaration points at — the same "caller's lists" contract
// wells already use, one door over (T-12779).
export type EntId = { id: string; kind: string }

// value candidates for one column: enums spell themselves, references offer the
// caller's entities of the pointed-at kind, wells are the caller's lists, *_at
// columns get the time grammar. Only the last comma-part completes — any-of
// lists finish one part at a time.
let values = (
  base: string,
  op: string,
  at: Hop,
  value: string,
  wells?: Record<string, string[]>,
  ents?: EntId[],
): Cand[] => {
  let cut = value.lastIndexOf(',') + 1
  let tail = value.slice(0, cut), pre = value.slice(cut)
  let t = typeOf(at.comp, at.prop)
  let list: [string, string][] = t && typeof t == 'object' && 'enum' in t
    ? t.enum.map((v) => [v, at.prop] as [string, string])
    : t && typeof t == 'object' && 'eid' in t
    ? (ents ?? [])
      .filter((e) => t.eid == 'entity' || e.kind == t.eid)
      .map((e) => [e.id, e.kind] as [string, string])
    : t && typeof t == 'object' && 'text' in t
    ? (wells?.[t.text] ?? []).map((v) => [v, t.text] as [string, string])
    : t == 'bool'
    ? [['1', 'true'], ['0', 'false']] as [string, string][]
    : t == 'time'
    ? TIMES.map((v) => [v, 'time'] as [string, string])
    : []
  return list.filter(([v]) => starts(v, pre) && v != pre)
    .map(([v, kind]) => ({ text: base + op + tail + v, kind }))
}

export let complete = (
  token: string,
  wells?: Record<string, string[]>,
  ents?: EntId[],
): Cand[] => {
  // a half-typed op ('.p!', '.p~') wants its '='
  let half = token.match(/^(\.[A-Za-z_]+(?:\.[A-Za-z_]+)*)([!~])$/)
  if (half) {
    return OP_WORDS.filter(([op]) => op != half[2] && op.startsWith(half[2]))
      .map(([op, kind]) => ({ text: half[1] + op, kind }))
  }

  // value position: an op is present — complete the value by the leaf's type
  let m = token.match(
    /^\.([A-Za-z_]+(?:\.[A-Za-z_]+)*)(!=|~=|<=|>=|<|>|=)(.*)$/s,
  )
  if (m) {
    let [, path, op, value] = m
    if (path == ORDER) {
      return ['hot', 'search', 'similar'].filter((v) =>
        starts(v, value) && v != value
      )
        .map((v) => ({ text: `.order=${v}`, kind: 'rank' }))
    }
    let at = aimPath(path)
    return at ? values(`.${path}`, op, at, value, wells, ents) : []
  }

  // an Nth segment: walk the settled prefix; a trailing lone component dangles
  // for its prop (the explicit spelling lists its columns), else the tail
  // begins a fresh hop off the far side (bare-routable props of the TARGET).
  let seg = token.match(/^\.([A-Za-z_]+(?:\.[A-Za-z_]+)*)\.([A-Za-z_]*)$/)
  if (seg) {
    let [, prefix, pre] = seg
    let segs = prefix.split('.')
    let dangling: string | null = null
    let ok = true
    for (let i = 0; ok && i < segs.length;) {
      if (routes[segs[i]] && i + 1 < segs.length) {
        if (!isRef(segs[i], segs[i + 1])) ok = false
        i += 2
      } else if (routes[segs[i]]) {
        dangling = segs[i] // a component awaiting its prop
        i += 1
      } else {
        let r = tryRoute(segs[i])
        if (!r || !isRef(r.comp, r.prop)) ok = false
        i += 1
      }
    }
    if (!ok) return []
    if (dangling) {
      let a = dangling
      return [
        ...routes[a].includes(pre) ? opsFor(`.${prefix}.${pre}`) : [],
        ...routes[a].filter((p) => starts(p, pre) && p != pre).toSorted()
          .map((p) => ({ text: `.${prefix}.${p}`, kind: mark(a, p) })),
      ]
    }
    return [
      ...pre && tryRoute(pre) ? opsFor(`.${prefix}.${pre}`) : [],
      ...bares()
        .filter((c) => starts(c.text.slice(1), pre) && c.text.slice(1) != pre)
        .map((c) => ({ text: `.${prefix}${c.text}`, kind: c.kind })),
    ]
  }

  // first segment: an exact prop offers its ops; then comps, then props
  let first = token.match(/^\.([A-Za-z_]*)$/)
  if (!first) return []
  let pre = first[1]
  let routed = pre ? tryRoute(pre) : null
  return [
    ...routed ? (routed.prop ? opsFor(`.${pre}`) : presenceOps(`.${pre}`)) : [],
    ...Object.keys(routes).filter((c) => starts(c, pre)).toSorted()
      .map((c) => ({ text: `.${c}.`, kind: 'comp' })),
    ...bares().filter((c) =>
      starts(c.text.slice(1), pre) && c.text.slice(1) != pre
    ),
    ...starts(ORDER, pre)
      ? ['hot', 'search', 'similar'].map((v) => ({
        text: `.order=${v}`,
        kind: 'rank',
      }))
      : [],
    ...starts('near', pre) ? [{ text: '.near=', kind: 'rank' }] : [],
    ...starts('limit', pre) ? [{ text: '.limit=', kind: 'window' }] : [],
    ...starts('after', pre) ? [{ text: '.after=', kind: 'window' }] : [],
  ]
}
