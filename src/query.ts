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
// Bare words are TEXT preds — contains over the doc (title or body),
// case-insensitive; "quoted words" stay one pred. Separators are '&' and
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
// proposed — so spell those out (`.created.at`, `.decided.at`).
//
// References go sugar-free: `.assignee=jeff` — a prop with no column of
// its own, where exactly one component carries `prop_eid`, routes to
// that reference; the VALUE resolves like any id (alias, T-3, raw eid)
// at whichever door or evaluator holds the graph (resolveRefs). And a
// dotted first segment that names a COMPONENT is the explicit spelling
// (`.pin.x=12`); any other first segment is a PATH — `.assignee.title~=j`
// dereferences the eid column and predicates the target's prop. Depth 1.
import { parseProp, type Prop, propAt } from './props.ts'
import { comps, kindOrder, stamped } from './types.ts'
import { type Span, span } from './time.ts'

export type Pred = {
  comp: string
  prop: string
  op: string
  value: string
  // A path predicate's far side: deref `comp.prop` (an _eid column),
  // then test the TARGET's `at.comp[at.prop]` against op/value.
  at?: { comp: string; prop: string }
}

// What a pred evaluates against: an entity's components, merged — the
// shape of both a live-cache row and a client Row's `.comps`.
type Comps = Record<string, Record<string, unknown> | undefined>

// The routing table: every component's columns, plus the spine's.
// Server-stamped columns join HERE from the `stamped` declaration, not
// comps — filterable ('.count>=5') without ever joining the write
// allowlist (cols() reads comps alone). Four stamped comps today, not
// all of them: stamped.session's status would make bare `.status`
// ambiguous with task's, so widening is a routing question (does the
// wire-writable column win a tie?), not a list edit. Mail joined for the
// mail door — its filters live on arrival columns ('.verified=0',
// '.received_at>=today').
let routes: Record<string, readonly string[]> = {
  ...Object.fromEntries(
    Object.entries(comps).map(([name, props]) => [name, Object.keys(props)]),
  ),
  entity: Object.keys(stamped.entity),
  memory: [...Object.keys(comps.memory), ...Object.keys(stamped.memory)],
  recall: Object.keys(stamped.recall),
  mail: [...Object.keys(comps.mail), ...Object.keys(stamped.mail)],
  // Provenance carries a wire-writable `by` and a stamped `at` (T-6670);
  // both share those names, so bare `.at`/`.by` are ambiguous — spell out
  // `.created.at`, `.updated.by`, the pin/camera precedent.
  created: [...Object.keys(comps.created), ...Object.keys(stamped.created)],
  updated: [...Object.keys(comps.updated), ...Object.keys(stamped.updated)],
  // `decided` splits the same stamp the other way — `at`/`by` on the wire,
  // `via` stamped — so its routes are the same union, and `.decided.at` is
  // the spelling `## decided` and `task decided` both answer.
  decided: [...Object.keys(comps.decided), ...Object.keys(stamped.decided)],
  proposed: [...Object.keys(comps.proposed), ...Object.keys(stamped.proposed)],
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

let spawnTwin = (prop: string, owners: string[]) =>
  prop in comps.spawn && owners.length == 2 &&
  owners.every((name) => name == 'session' || name == 'spawn')

// Route a bare prop to its component; ambiguity is an error that names
// the candidates rather than a guess. The sugar rule rides here: a prop
// with no column of its own, where exactly ONE component carries
// `prop_eid`, routes to that reference — so `.assignee=jeff` IS
// `.assignee_eid=jeff`, and every ref column gets the short form free.
export let route = (prop: string): { comp: string; prop: string } => {
  let hits = (p: string) =>
    Object.entries(routes)
      .filter(([, cols]) => cols.includes(p))
      .map(([name]) => name)
  let own = hits(prop)
  if (own.length == 1) return { comp: own[0], prop }
  // Spawn's legacy session aliases are one concept during the rolling
  // window: filters read either home, while write routing chooses explicitly.
  if (spawnTwin(prop, own)) return { comp: '', prop }
  if (own.length > 1) {
    throw new Error(
      `.${prop} is ambiguous (${own.join(', ')}) — use .${own[0]}.${prop}`,
    )
  }
  let ref = hits(`${prop}_eid`)
  if (ref.length == 1) return { comp: ref[0], prop: `${prop}_eid` }
  // Several comps sharing a ref name (actor_eid on client AND session)
  // stay one CONCEPT: comp '' means any-of, and matchQuery scans every
  // comp for the prop. Writes can't aim at "any" — param() rejects the
  // bare form and asks for the explicit spelling.
  if (ref.length > 1) return { comp: '', prop: `${prop}_eid` }
  // A facet is itself filterable. Scalar and reference columns win above,
  // preserving `.project=P-3`; a component with no namesake column gets the
  // presence grammar (`=` absent, `~=` present) without a second vocabulary.
  if (prop in comps) return { comp: prop, prop: '' }
  // The rejection is the teaching moment: agents keep reaching for kind
  // and eid as filter props — name what the asker meant, one line each.
  // (.id needs no branch: session.id owns it, so it routes.)
  throw new Error(
    prop == 'kind'
      ? 'kind selects what to LIST, it is not a filter prop — ' +
        'task list projects, graph_query kind=project'
      : prop == 'eid'
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

// '.order=hot' is a RANKING, not a filter: matchQuery lets it through,
// adopt() ignores it, and orderOf() hands the value to whoever sorts.
// One value today; the grammar grows values here, not mechanisms.
export let ORDER = 'order'

export let orderOf = (preds: Pred[]) => preds.find((p) => p.op == ORDER)?.value

// `doc` sits in kindOrder as the fallback NAME for a bare document, but
// every kind wears one — so a doc pred is never the cross-kind mistake.
// Anything outside kindOrder (created, updated, recall) is a facet too.
let facet = (comp: string) => comp == 'doc' || !kindOrder.includes(comp)

// An empty result is the one moment a caller cannot tell INTERPRETATION
// from data. A pred naming another kind's column is perfectly valid, so it
// matches nothing and prints exactly like a truthful "none" — `.from=jeff`
// routes to mail.from and answers "no matches" for TASKS; `.to=holdco`
// routes to mail.to (a real column, so the _eid sugar never fires) and
// never consults wake.to_eid. Both were read as evidence of absence.
//
// So on empty — and only on empty — a door says how the filters actually
// routed. This reports what route() DID, never what COULD match: an entity
// may carry `task` and `mail` both and still be NAMED a task (kindOf takes
// the first component in kindOrder), so impossibility is not derivable and
// a refusal here would be a policy wearing a fact's clothes. Being advisory
// is what makes it safe to add: a legitimate "none" is unchanged.
export let resolution = (preds: Pred[], kind?: string) => {
  let crossed = preds.filter((p) =>
    p.op != ORDER && p.comp && p.comp != kind && !facet(p.comp)
  )
  // The suggestion is composed through the routing table, so it can only
  // name a spelling that parses — an error naming a door owes that much.
  let alt = (prop: string) => {
    let cols = (kind ? routes[kind] : undefined) ?? []
    return cols.includes(prop)
      ? `.${kind}.${prop}`
      : cols.includes(`${prop}_eid`)
      ? `.${kind}.${prop}_eid`
      : ''
  }
  return crossed
    .map((p) => {
      let mean = alt(p.prop)
      return `${p.comp}.${p.prop}${mean ? ` — did you mean ${mean}=?` : ''}`
    })
    .join(', ')
}

// Shared-reference sugar has no one owning component, but its type is still
// known: every routed column ends in _eid. All other aims come straight from
// the vocabulary, including a path's far side.
let typed = (comp: string, prop: string): Prop | undefined =>
  propAt(comp, prop) ??
    (!comp && prop.endsWith('_eid')
      ? {
        comp,
        prop,
        name: prop,
        type: { eid: '', death: 'keep' },
      }
      : undefined)

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

// A hyphen is admitted into the NAME so a hyphenated spelling reaches
// route() and earns the same refusal writes give it (client.ts param()).
// No column is hyphenated, so nothing new routes — but before this,
// '.blocked-by=T-1' failed the pattern and fell through to a bare TEXT
// term, silently searching for the filter the caller thought they wrote.
export let pred = (token: string): Pred | null => {
  let m = token.match(
    /^\.([A-Za-z_-]+)(?:\.([A-Za-z_-]+))?(!=|~=|<=|>=|<|>|=|!)(.*)$/s,
  )
  if (!m) return null
  let [, a, b, op, value] = m
  if (op == '!' && value) {
    throw new Error(`presence filters end at !: .${a}${b ? `.${b}` : ''}!`)
  }
  // a quoted value is the escape hatch for spaces where whitespace splits
  value = value.replace(/^"(.*)"$/s, '$1')
  if (a == 'order' && !b && op == '=') {
    return { comp: '', prop: 'order', op: ORDER, value }
  }
  let p: Pred
  if (b) {
    // The collision rule: a first segment naming a COMPONENT is the
    // explicit spelling (.pin.x); anything else walks a reference.
    if (routes[a]) {
      if (!routes[a].includes(b)) throw new Error(`no such prop: .${a}.${b}`)
      p = { comp: a, prop: b, op: OPS[op], value }
    } else {
      let r = route(a)
      if (!r.prop.endsWith('_eid')) {
        throw new Error(`.${a} is not a reference — paths walk _eid columns`)
      }
      p = { ...r, op: OPS[op], value, at: route(b) }
    }
  } else {
    p = { ...route(a), op: OPS[op], value }
  }
  if (!p.prop) {
    if (p.value || (p.op != '' && p.op != '~' && p.op != EXISTS)) {
      throw new Error(
        `component filters are presence tests: .${p.comp}= is absent, ` +
          `.${p.comp}! is present`,
      )
    }
    return p
  }
  // Contains is deliberately literal. Absence has no scalar atom. Every
  // other form parses each scalar/list/range atom against the near or far
  // property's type before a row is scanned.
  let tgt = p.at ?? p
  let type = typed(tgt.comp, tgt.prop)
  if (type && p.op != '~' && p.value != '') {
    p.value = typedValue(type, p.value)
  }
  return p
}

// The rejection every strict door throws when pred() shrugs: the error
// is the teaching moment, so it names where a stray predicate lives —
// kind= is graph_query's parameter, not a filter — and sketches the
// dot-param shape (FILTERS in grammar.ts spells the operators).
export let noFilter = (f: string) =>
  `not a filter: ${f} — ${
    f.startsWith('kind=') ? "kind is graph_query's kind parameter; " : ''
  }${SKETCH}`

// A bare word: contains over the doc, title or body. comp/prop are for
// show — matchQuery treats TEXT specially (one pred, two columns).
export let TEXT = 'text'
let text = (value: string): Pred => ({
  comp: 'doc',
  prop: '*',
  op: TEXT,
  value,
})

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
// box mixes terms and filters in one line. Empty: matches everything.
export let parseQuery = (q: string): Pred[] =>
  segments(q).map((t) => t.trim()).filter(Boolean).flatMap((seg) => {
    if (seg.startsWith('.') && !/\s\./.test(seg)) {
      let p = pred(seg) // null = an opless dot-word (.env) — a term
      if (p) return [p]
    }
    return (seg.match(/[^\s"]+"[^"]*"|"[^"]*"|\S+/g) ?? []).map((tok) => {
      if (tok.startsWith('.')) {
        let p = pred(tok)
        if (p) return p
      }
      return text(tok.replace(/^"(.*)"$/s, '$1'))
    })
  })

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
  let target = p.at ?? p
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
// Is (comp, prop) an entity reference? The _eid suffix is the fast path
// (and the only signal for the any-of comp ''), else the vocabulary's
// PropType — so a differently-named ref like created.by still resolves its
// sugar value ('.created.by=jeff').
let isRef = (comp: string, prop: string) => {
  if (prop.endsWith('_eid')) return true
  let t = comps[comp]?.[prop] ?? stamped[comp]?.[prop]
  return typeof t == 'object' && 'eid' in t
}
export let resolveRefs = (
  preds: Pred[],
  lookup: (id: string) => string | undefined,
): Pred[] =>
  preds.map((p) => {
    let target = p.at ? p.at.prop : p.prop
    let comp = p.at ? p.at.comp : p.comp
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
// evaluator's graph); no ent, no ref, or no target reads as an absent
// value — so `.assignee.title=x` misses and `!=x` holds, same as any
// null column.
//
// `now` is the clock a time phrase reads. It defaults to the wall clock,
// which is what every door wants — a saved `today` must advance tomorrow.
// It is a parameter because a moving phrase names a window the clock moves
// THROUGH, so the only way to state "this row has aged out" as a test is to
// hand the matcher a later moment (see the subscription sweep).
export let matchQuery = (
  c: Comps,
  preds: Pred[],
  ent?: (eid: string) => Comps | undefined,
  now?: number,
) =>
  preds.every((p) => {
    if (p.op == ORDER) return true
    if (p.op == TEXT) {
      let d = c.doc as { title?: string; body?: string } | undefined
      let needle = p.value.toLowerCase()
      return !!d && (
        String(d.title ?? '').toLowerCase().includes(needle) ||
        String(d.body ?? '').toLowerCase().includes(needle)
      )
    }
    if (!p.prop) return p.op == '~' || p.op == EXISTS ? !!c[p.comp] : !c[p.comp]
    if (p.at) {
      let ref = read(c, p.comp, p.prop)
      let t = ref ? ent?.(String(ref)) : undefined
      return test(t && read(t, p.at.comp, p.at.prop), p, now)
    }
    return test(read(c, p.comp, p.prop), p, now)
  })

// One column read, honoring route()'s any-of: comp '' means the prop is
// a shared ref name (actor_eid), so take the first value any comp holds
// — an entity carries at most one of the sharing comps in practice.
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
  if (!comp) {
    return Object.values(c).map((v) => v?.[prop]).find((v) => v != null)
  }
  let v = c[comp]?.[prop]
  return v == null && comp == 'updated' && prop == 'at' ? c.created?.at : v
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
export let sunk = (
  c: Comps,
  ent?: (eid: string) => Comps | undefined,
): boolean => {
  if (c.project?.retired_at) return true
  let p = c.task?.project_eid
  return !!(p && ent?.(String(p))?.project?.retired_at)
}
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
let mark = (c: string, p: string) => comps[c]?.[p] ? c : `${c} · stamped`

let typeOf = (comp: string, prop: string) => typed(comp, prop)?.type

let tryRoute = (p: string) => {
  try {
    return route(p)
  } catch {
    return null
  }
}

// every '.prop' route() accepts bare: unique columns plus the _eid sugar
// names (.assignee for assignee_eid — shared refs too, route()'s any-of)
let bares = (): Cand[] => {
  let owners = new Map<string, string[]>()
  for (let [c, cols] of Object.entries(routes)) {
    for (let p of cols) owners.set(p, [...owners.get(p) ?? [], c])
  }
  let out: Cand[] = []
  for (let [p, cs] of owners) {
    if (cs.length == 1) out.push({ text: `.${p}`, kind: mark(cs[0], p) })
    if (p.endsWith('_eid') && !owners.has(p.slice(0, -4))) {
      out.push({
        text: `.${p.slice(0, -4)}`,
        kind: cs.length == 1 ? `${cs[0]} · ref` : 'ref',
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

// which column a token's base names — the same resolution pred() does,
// silent instead of thrown (mid-keystroke is no place to error)
let aim = (a: string, b?: string): { comp: string; prop: string } | null => {
  try {
    if (!b) return route(a)
    if (routes[a]) return routes[a].includes(b) ? { comp: a, prop: b } : null
    let r = route(a)
    return r.prop.endsWith('_eid') ? route(b) : null
  } catch {
    return null
  }
}

// value candidates for one column: enums spell themselves, wells are the
// caller's lists, *_at columns get the time grammar. Only the last
// comma-part completes — any-of lists finish one part at a time.
let values = (
  base: string,
  op: string,
  at: { comp: string; prop: string },
  value: string,
  wells?: Record<string, string[]>,
): Cand[] => {
  let cut = value.lastIndexOf(',') + 1
  let tail = value.slice(0, cut), pre = value.slice(cut)
  let t = typeOf(at.comp, at.prop)
  let list: [string, string][] = t && typeof t == 'object' && 'enum' in t
    ? t.enum.map((v) => [v, at.prop] as [string, string])
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
): Cand[] => {
  // a half-typed op ('.p!', '.p~') wants its '='
  let half = token.match(/^(\.[A-Za-z_]+(?:\.[A-Za-z_]+)?)([!~])$/)
  if (half) {
    return OP_WORDS.filter(([op]) => op != half[2] && op.startsWith(half[2]))
      .map(([op, kind]) => ({ text: half[1] + op, kind }))
  }

  // value position: an op is present — complete the value by its type
  let m = token.match(
    /^\.([A-Za-z_]+)(?:\.([A-Za-z_]+))?(!=|~=|<=|>=|<|>|=)(.*)$/s,
  )
  if (m) {
    let [, a, b, op, value] = m
    if (a == ORDER && !b) {
      return starts('hot', value) && value != 'hot'
        ? [{ text: '.order=hot', kind: 'rank' }]
        : []
    }
    let at = aim(a, b)
    return at ? values(`.${a}` + (b ? `.${b}` : ''), op, at, value, wells) : []
  }

  // second segment: the explicit spelling lists the comp's columns; a
  // path lists the far side — any bare-routable prop of the TARGET
  let seg = token.match(/^\.([A-Za-z_]+)\.([A-Za-z_]*)$/)
  if (seg) {
    let [, a, pre] = seg
    if (routes[a]) {
      return [
        ...routes[a].includes(pre) ? opsFor(`.${a}.${pre}`) : [],
        ...routes[a].filter((p) => starts(p, pre) && p != pre).toSorted()
          .map((p) => ({ text: `.${a}.${p}`, kind: mark(a, p) })),
      ]
    }
    if (!tryRoute(a)?.prop.endsWith('_eid')) return []
    return [
      ...pre && tryRoute(pre) ? opsFor(`.${a}.${pre}`) : [],
      ...bares()
        .filter((c) => starts(c.text.slice(1), pre) && c.text.slice(1) != pre)
        .map((c) => ({ text: `.${a}${c.text}`, kind: c.kind })),
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
    ...starts(ORDER, pre) ? [{ text: '.order=hot', kind: 'rank' }] : [],
  ]
}
