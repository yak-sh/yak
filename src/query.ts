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
//   .prop~=          present — an empty needle asks for the COLUMN, the same
//                    thing `.prop!` asks (never "every row contains ''")
//   .prop<v <=v >v >=v   comparisons (numeric when both sides are numbers)
//
//   .limit=200       a WINDOW: 200 matches, not the whole set
//   .after=13882     continue that window past one entity, named by its spine
//                    num — the next page, in whatever order was asked for
//
// Bare words are TEXT preds — FTS5 terms over the doc (title or body), with a
// trailing `*` for token-prefix matching; "quoted words" stay one phrase pred.
// Separators are '&' and
// whitespace both: every term stands alone; quote multiword values
// (.title~="two words"). Single/double quotes and escaping are shared grammar.
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
import { IdError } from './types.ts'
import { isRef, parseProp, type Prop } from './props.ts'
import { edges, kindOrder, kindWord, sessionComps, statusOf } from './types.ts'
import type { Vocab } from './store/vocab.ts'
import {
  groupsOf,
  kind,
  NONE,
  owned,
  refCols,
  REFS_PROP,
  reverseAssocs,
  routed,
  routes,
  taught,
  typeAt,
  typed,
} from './route.ts'
import { term as ftsTerm } from '@yaks/fts'
import {
  type Clause,
  parse,
  parseDot,
  type Span,
  timeSpan,
  type Value,
} from '@yaks/query'
export { ftsTerm }
export { WALK_DEPTH, WALK_LIMIT } from '@yaks/query'

// One rung of a path predicate: a component's column read on the entity this
// hop lands on. Every hop but the last is an `{eid}` deref; the last is the
// leaf tested against op/value.
export type Hop = { comp: string; prop: string }

// A stored-edge selector carried by the EDGES rider. `type` narrows edge
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
  // An OR (`.a=1|.b=2&.c=3`, op OR): alternatives, each an AND list, and no
  // comp/prop/value of its own. Only filters live inside — a directive (order,
  // fields, tally, edges, window) rides the top level, where every reader of
  // the list looks for it.
  alts?: Pred[][]
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
  // The EDGES RIDER's BOUND — `.edges.limit=200`. A hub's incident set is not
  // what a card renders, and each edge beyond the bound costs a projected peer
  // row, so the rider windows like a row set does: a prefix, newest sentences
  // first, and the reply states the total it is a prefix of. Its own field
  // rather than `win`, which is the ROW window and spells itself `.limit=`.
  limit?: number
  // A WALK rather than a column read: `.requires[<=3]->T-42` selects
  // the entities that reach `value` through at most `depth` hops of one step —
  // an edge type, or a reference column (`via`) — and `<-` walks the other way.
  // op is REACHES. No bracket means depth-free with a WALK_LIMIT row valve;
  // only an explicit [<=N] brings the hop cap back.
  reach?: Reach
}

// A window: how many of the selection to answer with, and where to continue.
// Both optional — `.limit=` alone is the first page, `.after=` alone continues
// an unbounded read below a cursor. A window states a SIZE, never a sequence:
// with no `.order` the sequence is spine num, so `after` reads as "older than
// this num"; with one (`.order=hot`, `.order=similar`) the asked-for order
// survives and `after` names the entity to continue past IN THAT ORDER
// (graph_query.ts pageRanked). One cursor spelling — the entity's num — serves
// every ordering, so a caller pages without learning the order key.
export type Win = { limit?: number; after?: number }

// A window over a RANKING (`.order=hot`, `.order=similar`) rather than over the
// spine. An explicit order SURVIVES a window — a window says how much of a
// sequence to answer with, never which sequence — so the cursor is the anchor's
// place in the RANKING, not a num to compare against. The cursor spelling never
// changes: `.after=<num>` names an entity, and each evaluator derives where that
// entity sits in the order it was asked for (the same rule @yaks/sql compiles as
// a keyset and @yaks/match answers in memory). An anchor the ranking does not
// hold restarts from the front, which is what a first page already is.
export let pageRanked = <T extends { num: number }>(
  rows: T[],
  win: Win,
): T[] => {
  let at = win.after == null ? -1 : rows.findIndex((r) => r.num == win.after)
  let rest = rows.slice(at + 1)
  return win.limit == null ? rest : rest.slice(0, win.limit)
}

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
export type Comps = Record<string, Record<string, unknown> | undefined>

// One token — '.priority<=1', '.domain=Ops,Eng' — to a Pred; null if the
// string isn't a dot-param at all.
export let EXISTS = 'exists'
// `.loan?` asks for a component WITHOUT filtering on it: an optional
// presence, requested. It selects nothing and screens nothing — `.book!` says
// which entities the answer is about, `.book!&.loan?` says the answer should
// carry their loans too, where they have one. A door that projects reads it
// (workers/yak/graph.ts); every evaluator lets it through like a ranking.
export let WANT = 'want'
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
    if (p.op == OR) {
      for (let alt of p.alts!) {
        let inner = predComps(alt)
        if (!inner) return null
        for (let c of inner) out.add(c)
      }
      continue
    }
    if (p.refs || p.at || p.rev) return null
    if (p.op == ORDER && p.value == 'hot') return null
    if (p.op == ORDER && p.value == 'priority') out.add('filed')
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
export type EdgeRider = { peers: Hop[]; select?: EdgeSelector; limit?: number }

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
  // The TIGHTEST bound wins: two tokens asking for one delivery cannot each get
  // their own length, and the smaller ask is the one that is satisfied by it.
  let limits = asked.flatMap((p) => p.limit == null ? [] : [p.limit])
  let limit = limits.length ? Math.min(...limits) : undefined
  return {
    peers,
    ...(select ? { select } : {}),
    ...(limit == null ? {} : { limit }),
  }
}

// A WALK pred — `.requires[<=3]->T-42` — is a real filter, not a rider: it
// SELECTS a transitive closure over one step, optionally capped by hops.
// sql.ts compiles it to a recursive CTE over the indexed dep table (or the
// reference column); the JS matcher answers it from a `walk` that resolves the
// same closure once per query rather than per row.
export let REACHES = 'reaches'

// The walk's step and shape: `type` is the edge type walked, or the raw path of
// a reference column, which `via` then names; `dir` is the arrow — `->` the
// candidate reaches the target, `<-` the target reaches the candidate.
export type Reach = {
  type: string
  depth?: number
  dir: '->' | '<-'
  via?: Hop
}

// The traversal closures a pred list asks for, deduped — what a door precomputes
// before matching so the walk happens once, not per candidate row.
export let reachesOf = (preds: Pred[]): Pred[] =>
  preds.filter((p) => p.op == REACHES)

// Who reaches a walk's target: the eids within `depth` steps of `value`, along
// the arrow. One per query — every row then tests with a Set lookup.
export type Walk = (reach: Reach, target: string) => Set<string>

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

// A `blob` is content-addressed STORAGE wearing an entity's clothes: every doc
// body lands as one (db.ts textBlob), and an attachment's bytes as another, so
// the store's own rows sit in the spine a filter selects from. They carry no
// doc and no kind, so a listing that catches one renders nothing for it — which
// is what a person saw (C-32498 item 4). Naming the component is the deliberate
// opt-in, the same step `quarantined` asks for.
//
// `image` names them too: dimensions belong to the content (its row keys on
// blob), so a filter that asks for one can be asking for nothing else, and a
// photo wall reading what its pictures measure should not have to say `.blob!`
// to be allowed the answer (C-32706 item 1).
let ON_BLOB = ['blob', 'image']

export let namesBlobs = (preds: Pred[]) =>
  preds.some((p) =>
    ON_BLOB.includes(p.comp) || ON_BLOB.includes(leafOf(p).comp)
  )

// Does this row belong in the answer a FILTER selects? The caller's own preds
// decided that; these are the two screens every listing carries beside them.
// `id=` addresses entities instead of selecting them, so it keeps `listed`
// alone — naming a blob's sha IS asking for it.
export let selected = (comps: Comps, preds: Pred[]) =>
  listed(comps, preds) && (!comps.blob || namesBlobs(preds))

// The pred list a COMPILED membership statement should carry: the caller's
// filter plus the universal screens a door otherwise applies in JS after the
// statement — quarantine and the store's blob rows (selected) and the lazy
// entry partition (namesLazy). All three are spelled as ordinary
// component-ABSENCE preds, so the existing compiler answers them from the same
// LEFT JOIN it gives any facet, and namesLazy's `.prop == '' && .op == ''`
// guard keeps the entry screen from reading as an opt-IN to the partition.
//
// Why it matters beyond tidiness: a JS filter that runs AFTER a statement's
// LIMIT under-fills the page, so a window can only be exact once the screens
// the answer depends on are inside the same statement. `search()` (db.ts) has
// unshifted the quarantine half by hand since before this existed.
let absent = (comp: string): Pred => ({ comp, prop: '', op: '', value: '' })
export let screened = (preds: Pred[], entries: boolean): Pred[] => [
  ...preds,
  ...reveals(preds) ? [] : [absent('quarantined')],
  ...namesBlobs(preds) ? [] : [absent('blob')],
  ...entries || preds.some((p) => p.op == TEXT) ? [] : [absent('entry')],
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
    p.op != ORDER && p.op != NEAR && p.op != AGG && p.op != WANT && !p.refs &&
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

// Time phrases stay authored: a saved `today` must advance tomorrow. timeSpan()
// validates that language without freezing it; every other scalar becomes its
// canonical comparison string through the same parser writes use.
let atom = (p: Prop, value: string): string => {
  if (!value) return value
  if (kind(p) == 'time' && timeSpan(value)) return value
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

// Grammar belongs to @yaks/query. This pass binds its schema-free clauses to
// the fleet's routed predicates (also consumed by browser matching, reference
// resolution and partition screens). Never stringify a clause to parse it again.
let flatValue = (v: Value | null): string => {
  if (!v) return ''
  if (v.kind == 'scalar' || v.kind == 'time') return v.raw
  if (v.kind == 'list') return v.items.map(flatValue).join(',')
  return `${flatValue(v.lo)}..${v.exclusiveEnd ? '.' : ''}${flatValue(v.hi)}`
}

let columnOf = (path: string[], vocab: Vocab, directive: string): Hop => {
  let groups = groupsOf(path, vocab)
  let at = groups[groups.length - 1]
  if (groups.length != 1 || !at.prop) {
    throw new Error(
      `${directive} names one column, not a path: ${path.join('.')}`,
    )
  }
  return at
}

// A directive inside an alternative would be read by nobody: orderOf, fieldsOf
// and the riders scan the top-level list. Refuse it there rather than let
// `(.a=1&.order=hot|.b=2)` quietly drop the order.
let alternative = (preds: Pred[]): Pred[] => {
  let rider = preds.find((p) =>
    [ORDER, NEAR, AGG, WINDOW, PROJECT, EDGES, WANT].includes(p.op)
  )
  if (rider) {
    throw new Error(`.${rider.op} belongs outside the | alternatives`)
  }
  return preds
}

export let bindClause = (c: Clause, vocab: Vocab = NONE): Pred[] => {
  let rider = (extra: Partial<Pred>): Pred[] => [{
    comp: '',
    prop: '',
    op: EDGES,
    value: '',
    peers: [],
    ...extra,
  }]
  switch (c.kind) {
    case 'and':
      return c.clauses.flatMap((c) => bindClause(c, vocab))
    case 'or':
      return [{
        comp: '',
        prop: '',
        op: OR,
        value: '',
        alts: c.clauses.map((a) => alternative(bindClause(a, vocab))),
      }]
    case 'never':
      return [never()]
    case 'text':
      return [text(c.value)]
    case 'resource':
      if (/^[0-9a-f]{6,64}$/i.test(c.comp)) {
        return bindClause(parse(`.eid=#${c.comp}`), vocab)
      }
      throw new Error(`a fleet read cannot evaluate resource #${c.comp}`)
    case 'every':
      return [] // full rows are the fleet's default projection
    case 'order':
      return [{ comp: '', prop: 'order', op: ORDER, value: c.value }]
    case 'near':
      return [{ comp: '', prop: 'near', op: NEAR, value: c.value }]
    case 'refs':
      return [{
        comp: '',
        prop: '',
        op: c.op == '!' ? EXISTS : '',
        value: c.value,
        refs: true,
      }]
    case 'count':
      return [{ comp: '', prop: '', op: AGG, value: '', agg: 'count' }]
    case 'distinct':
    case 'tally':
      return [{
        ...columnOf(c.path, vocab, `.${c.kind}`),
        op: AGG,
        value: '',
        agg: c.kind,
      }]
    case 'fields':
      return [{
        comp: '',
        prop: '',
        op: PROJECT,
        value: '',
        fields: c.fields.filter((f) => f.path.join('.') != 'eid').map((f) => ({
          ...columnOf(f.path, vocab, '.fields'),
          wake: f.wake,
        })),
      }]
    case 'limit':
    case 'after':
      return [{
        comp: '',
        prop: '',
        op: WINDOW,
        value: String(c.n),
        win: { [c.kind]: c.n },
      }]
    case 'edges': {
      let edge: EdgeSelector | undefined
      if (c.select) {
        let { type, via: path } = c.select
        if (!(edges as readonly string[]).includes(type)) {
          throw new Error(`.edges selects one edge type (${edges.join(', ')})`)
        }
        let via = path && columnOf(path, vocab, '.edges endpoint projection')
        if (via && !isRef(via.comp, via.prop)) {
          throw new Error('.edges endpoint projection must be one {eid} column')
        }
        edge = { type, ...(via ? { via } : {}) }
      }
      return rider({
        peers: c.peers.map((p) => columnOf(p, vocab, '.edges.peers')),
        ...(edge ? { edge } : {}),
        ...(c.limit != null ? { limit: c.limit } : {}),
      })
    }
    case 'walk': {
      let path = c.path.join('.')
      let reach: Reach = { type: path, depth: c.depth, dir: c.dir }
      if (!(edges as readonly string[]).includes(path)) {
        let via = columnOf(c.path, vocab, 'a walk')
        if (!isRef(via.comp, via.prop)) {
          throw new Error(
            `a walk follows an edge type (${
              edges.join(', ')
            }) or a reference column — not ${path}`,
          )
        }
        reach.via = via
      }
      return [{ comp: '', prop: '', op: REACHES, value: c.target, reach }]
    }
    case 'pred':
      break
    default:
      throw new Error(`a fleet read cannot evaluate ${c.kind}`)
  }
  let segs = c.path, op = c.op, value = flatValue(c.value)
  let assoc = reverseAssocs.get(segs[0])
  if (assoc) {
    let inner = c.where
      ? bindClause(c.where, vocab)
      : segs.length > 1
      ? bindClause({ ...c, path: segs.slice(1), not: undefined }, vocab)
      : []
    let count = !inner.length &&
      !(op == '!' || (op == '~=' && !value) || (op == '=' && !value))
    if (count && !/^\d+$/.test(value)) {
      throw new Error(
        `.${segs[0]} needs a sub-path (.${segs[0]}.<prop>) or a count (.${
          segs[0]
        }>=N)`,
      )
    }
    return [{
      ...assoc,
      op: count ? OPS[op] : EXISTS,
      value: count ? value : '',
      rev: {
        ...assoc,
        preds: inner,
        not: inner.length ? !!c.not : op == '=' && !value,
        ...(count ? { count: true } : {}),
      },
    }]
  }
  if (c.not || c.where) {
    throw new Error(`.${segs[0]} is not a reverse association`)
  }
  if (segs.length == 1 && segs[0] in scopes && !owned(segs[0])) {
    let out = scopes[segs[0]](value)
    if (!out) throw new Error(`no such ${segs[0]}: ${value || '(empty)'}`)
    return out
  }
  if (op == '?') {
    if (
      segs.length != 1 || value || (owned(segs[0]) && !routed(segs[0], vocab))
    ) {
      throw new Error(
        `.${
          segs.join('.')
        }? asks for a whole component beside the filter: .book!&.loan?`,
      )
    }
    return [{ comp: segs[0], prop: '', op: WANT, value: '' }]
  }
  let p: Pred
  if (segs.length == 1 && !value && op == '!' && routed(segs[0], vocab)) {
    p = { comp: segs[0], prop: '', op: OPS[op], value }
  } else {
    let groups = groupsOf(segs, vocab)
    let leaf = groups[groups.length - 1], derefs = groups.slice(0, -1)
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
      ? { ...derefs[0], op: OPS[op], value, at: [...derefs.slice(1), leaf] }
      : { ...leaf, op: OPS[op], value }
  }
  if (!p.prop) {
    if (p.value || (p.op != '' && p.op != '~' && p.op != EXISTS)) {
      throw new Error(
        `component filters are presence tests: .${p.comp}= is absent, .${p.comp}! is present`,
      )
    }
    return [p]
  }
  let leaf = leafOf(p)
  let type = typed(leaf.comp, leaf.prop) ??
    // Dynamic scalar columns are inline and type against THIS store too.
    (typeAt(leaf.comp, leaf.prop, vocab) && {
      ...leaf,
      name: leaf.prop,
      type: typeAt(leaf.comp, leaf.prop, vocab)!,
    })
  if (type && p.op != '~' && p.value != '') p.value = typedValue(type, p.value)
  return [p]
}

export let preds = (token: string, vocab: Vocab = NONE): Pred[] | null => {
  // Strict filter/write doors still require the dotted or presence spelling.
  if (!/^[.?!]/.test(token)) return null
  let clauses = parseDot(token)
  return clauses && clauses.flatMap((c) => bindClause(c, vocab))
}

// One scalar pred, or null — the door for writes' param check and unit
// assertions, where a token names a single filter. A multi-pred SCOPE belongs
// in a filter LIST (preds() is that door); this returns the scope's first pred.
export let pred = (token: string, vocab: Vocab = NONE): Pred | null => {
  let out = preds(token, vocab)
  return out ? out[0] : null
}

// The rejection every strict door throws when preds() shrugs: the error is the
// teaching moment, so it names where a stray predicate lives — a bare `kind=K`
// is the warm mistake, and the door says the dotted spelling that now works —
// and sketches the dot-param shape (FILTERS in grammar.ts spells the operators).
export let noFilter = (f: string) =>
  `not a filter: ${f} — ${
    f.startsWith('kind=') ? `write it dotted: .${f}; ` : ''
  }${taught}`

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

// Empty reads select nothing. Whitespace, & and comma separation, quoting,
// escaping and malformed-clause refusals are all owned by the package parser.
export let NEVER = 'never'
// The OR pred: see Pred.alts. Every evaluator (matchQuery, sql.ts, predComps)
// recurses into the alternatives; every reader of directives ignores it.
export let OR = 'or'
export let never = (): Pred => ({ comp: '', prop: '', op: NEVER, value: '' })
export let parseQuery = (q: string, vocab: Vocab = NONE): Pred[] =>
  bindClause(parse(q), vocab)

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
    let spans = p.value.split(',').map((value) => timeSpan(value, now))
    if (spans.every((s) => s)) {
      let hit = spans.some((s) => inTime(v, { ...p, op: '' }, s!))
      if (p.op == '' || p.op == '!') return p.op == '' ? hit : !hit
    }
    let s = timeSpan(p.value, now)
    if (s) return inTime(v, p, s)
  }
  switch (p.op) {
    case '':
      return eq(v, p.value)
    case '!':
      return !eq(v, p.value)
    case '~':
      // An empty needle asks PRESENCE — what `.prop~=` means everywhere else
      // in this grammar (a bare component, a reverse hop, the completion that
      // labels it 'present'). `''.includes('')` said the opposite: a filter
      // NAMING a column selected every entity in the graph, including the
      // store's own content-addressed rows, which wear no doc at all (T-32503).
      return p.value == ''
        ? v != null
        : String(v ?? '').toLowerCase().includes(p.value.toLowerCase())
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
    if (p.op == OR) {
      return { ...p, alts: p.alts!.map((a) => resolveRefs(a, lookup)) }
    }
    // A multi-column reverse-union's value is an id like any reference — but it
    // owns no comp/prop to type it, so resolve it through the entity target. A
    // traversal's target is the same shape: one entity, no column to type it.
    if (p.refs || p.op == REACHES) {
      if ((p.op != '' && p.op != REACHES) || !p.value) return p
      try {
        let value = String(parseProp(REFS_PROP, p.value, { resolve: lookup }))
        return value == p.value ? p : { ...p, value }
      } catch (error) {
        if (error instanceof IdError) throw error
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
    // The spine's `.eid=` names entities, so its operands are ids like a
    // reference's — resolved at the door the same way, so `.eid=T-3` lands.
    let spine = comp == 'entity' && target == 'eid'
    if ((!spine && !isRef(comp, target)) || (p.op != '' && p.op != '!')) {
      return p
    }
    if (!p.value || /\.\./.test(p.value)) return p
    let type = spine ? REFS_PROP : typed(comp, target)
    if (!type) return p
    let value = p.value.split(',')
      .map((part) => {
        if (!part) return part
        try {
          return String(parseProp(type, part, { resolve: lookup }))
        } catch (error) {
          if (error instanceof IdError) throw error
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
// at a path leaf (`.blocked!` and `.filed.project.archived!` mean the same thing
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
): boolean =>
  preds.every((p) => {
    if (p.op == NEVER) return false // the empty query: selects nothing
    if (p.op == OR) {
      return p.alts!.some((alt) =>
        matchQuery(c, alt, ent, now, kids, walk, fts)
      )
    }
    if (
      p.op == ORDER || p.op == NEAR || p.op == AGG || p.op == PROJECT ||
      p.op == EDGES || p.op == WANT
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

// The values a row must carry to satisfy the query's scalar equalities on
// one component — what a board drop patches, so a dropped task JOINS the
// board it landed on. Lists, ranges and comparisons pin nothing down.
export function adopt(
  preds: Pred[],
): Record<string, Record<string, string | number>>
export function adopt(
  preds: Pred[],
  comp: string,
): Record<string, string | number>
export function adopt(preds: Pred[], comp?: string) {
  if (comp == null) {
    let grouped: Record<string, Record<string, string | number>> = {}
    for (let name of new Set(preds.map((p) => p.comp).filter(Boolean))) {
      let values = adopt(preds, name)
      if (Object.keys(values).length) grouped[name] = values
    }
    return grouped
  }
  let out: Record<string, string | number> = {}
  for (let p of preds) {
    if (
      p.comp != comp || !p.prop || p.at?.length || p.op != '' || p.value == ''
    ) continue
    if (p.value.includes(',') || /\.\./.test(p.value)) continue
    out[p.prop] = /^-?\d+(\.\d+)?$/.test(p.value) ? Number(p.value) : p.value
  }
  return out
}
