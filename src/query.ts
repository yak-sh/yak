// The FILTER grammar — dot-params in URL query-param form. One parser for
// every reader: a board's saved query, `task list`, MCP task_list, and
// the search box. (Writes keep the plain `.prop=value` setter grammar in
// client.ts — a setter's comma is a literal comma; only filters interpret
// value forms.)
//
//   .status=open&.priority<=1&.domain=Ops,Eng
//   runner exit .status=done .modified_at=today     (search-style mix)
//
//   .prop=v          equals (string-compared, like everything on the wire)
//   .prop=a,b,c      any of
//   .prop=1..5       range, inclusive (1...5 excludes the end; ISO dates
//                    compare fine lexicographically)
//   .prop=           null / absent
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
// minute|hour|day|week|month|year, "5 minutes ago", "in 2 days" ('-'/'_'
// glue words where quoting is awkward: 1-hour-ago). A phrase names a
// RANGE and the op picks its edge: = within, >= from its start, <= until
// its end, > strictly after, < strictly before. So .modified_at=today is
// midnight-to-midnight, .modified_at>="1 hour ago" is the last hour.
//
// Unqualified props route by component, same rule as writes; `.task.status`
// is the explicit spelling. `.num` and friends route to the entity spine.
//
// References go sugar-free: `.assignee=jeff` — a prop with no column of
// its own, where exactly one component carries `prop_eid`, routes to
// that reference; the VALUE resolves like any id (alias, T-3, raw eid)
// at whichever door or evaluator holds the graph (resolveRefs). And a
// dotted first segment that names a COMPONENT is the explicit spelling
// (`.pin.x=12`); any other first segment is a PATH — `.assignee.title~=j`
// dereferences the eid column and predicates the target's prop. Depth 1.
import { comps } from './types.ts'

export type Pred = {
  comp: string
  prop: string
  op: string
  value: string
  // A path predicate's far side: deref `comp.prop` (an _eid column),
  // then test the TARGET's `at.comp[at.prop]` against op/value.
  at?: { comp: string; prop: string }
}

// ---- time phrases ----

export type Span = { start: number; end: number }

let UNIT_MS: Record<string, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
}

// A phrase to the [start, end) range it names, or null when it isn't one.
// Calendar units (month, year) shift by calendar, not by a fake constant;
// day boundaries are the EVALUATOR's midnight — the browser filters in the
// viewer's day, the server in its own.
export let span = (s: string, now = Date.now()): Span | null => {
  let raw = s.trim().toLowerCase()
  // a plain date is that day, in the evaluator's zone — matched BEFORE
  // the word-glue pass, whose job is '1-hour-ago', not date hyphens
  let iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    return {
      start: +new Date(+iso[1], +iso[2] - 1, +iso[3]),
      end: +new Date(+iso[1], +iso[2] - 1, +iso[3] + 1),
    }
  }
  let t = raw.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ')
  let d = new Date(now)
  let days = (a: number, b: number): Span => ({
    start: +new Date(d.getFullYear(), d.getMonth(), d.getDate() + a),
    end: +new Date(d.getFullYear(), d.getMonth(), d.getDate() + b),
  })
  // n calendar units away from now ('minute' etc. are exact, so only
  // month/year take this road)
  let shift = (n: number, unit: string) =>
    unit == 'month'
      ? +new Date(
        d.getFullYear(),
        d.getMonth() + n,
        d.getDate(),
        d.getHours(),
        d.getMinutes(),
        d.getSeconds(),
      )
      : +new Date(
        d.getFullYear() + n,
        d.getMonth(),
        d.getDate(),
        d.getHours(),
        d.getMinutes(),
        d.getSeconds(),
      )
  if (t == 'now') return { start: now, end: now }
  if (t == 'today') return days(0, 1)
  if (t == 'yesterday') return days(-1, 0)
  if (t == 'tomorrow') return days(1, 2)
  let m = t.match(/^(this|last|next) (minute|hour|day|week|month|year)$/)
  if (m) {
    let at = m[1] == 'this' ? 0 : m[1] == 'last' ? -1 : 1
    let u = m[2]
    if (u == 'day') return days(at, at + 1)
    if (u == 'week') { // weeks start Monday
      let mon = d.getDate() - ((d.getDay() + 6) % 7) + at * 7
      return {
        start: +new Date(d.getFullYear(), d.getMonth(), mon),
        end: +new Date(d.getFullYear(), d.getMonth(), mon + 7),
      }
    }
    if (u == 'month') {
      return {
        start: +new Date(d.getFullYear(), d.getMonth() + at, 1),
        end: +new Date(d.getFullYear(), d.getMonth() + at + 1, 1),
      }
    }
    if (u == 'year') {
      return {
        start: +new Date(d.getFullYear() + at, 0, 1),
        end: +new Date(d.getFullYear() + at + 1, 0, 1),
      }
    }
    // minute/hour: floor now to the unit, then step
    let w = UNIT_MS[u]
    let start = Math.floor(now / w) * w + at * w
    return { start, end: start + w }
  }
  m = t.match(/^(\d+) (minute|hour|day|week|month|year)s? ago$/)
  if (m) {
    let n = Number(m[1]), u = m[2]
    return { start: UNIT_MS[u] ? now - n * UNIT_MS[u] : shift(-n, u), end: now }
  }
  m = t.match(/^in (\d+) (minute|hour|day|week|month|year)s?$/)
  if (m) {
    let n = Number(m[1]), u = m[2]
    return { start: now, end: UNIT_MS[u] ? now + n * UNIT_MS[u] : shift(n, u) }
  }
  return null
}

// What a pred evaluates against: an entity's components, merged — the
// shape of both a live-cache row and a client Row's `.comps`.
type Comps = Record<string, Record<string, unknown> | undefined>

// The routing table: every component's columns, plus the spine's.
// Server-stamped columns join HERE, not in comps — filterable ('.count>=5')
// without ever joining the write allowlist (cols() reads comps alone).
let routes: Record<string, readonly string[]> = {
  ...Object.fromEntries(
    Object.entries(comps).map(([name, props]) => [name, Object.keys(props)]),
  ),
  entity: ['num', 'created_at', 'modified_at'],
  memory: [...Object.keys(comps.memory), 'last_confirmed_at'],
  recall: ['count', 'first_at', 'last_at'],
}

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
  if (own.length > 1) {
    throw new Error(
      `.${prop} is ambiguous (${own.join(', ')}) — use .${own[0]}.${prop}`,
    )
  }
  let ref = hits(`${prop}_eid`)
  if (ref.length == 1) return { comp: ref[0], prop: `${prop}_eid` }
  if (ref.length > 1) {
    throw new Error(
      `.${prop} is ambiguous (${
        ref.join(', ')
      } all carry ${prop}_eid) — use .comp.${prop}_eid`,
    )
  }
  throw new Error(`unknown prop: .${prop}`)
}

// One token — '.priority<=1', '.domain=Ops,Eng' — to a Pred; null if the
// string isn't a dot-param at all.
let OPS: Record<string, string> = {
  '=': '',
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

export let pred = (token: string): Pred | null => {
  let m = token.match(
    /^\.([A-Za-z_]+)(?:\.([A-Za-z_]+))?(!=|~=|<=|>=|<|>|=)(.*)$/s,
  )
  if (!m) return null
  let [, a, b, op, value] = m
  // a quoted value is the escape hatch for spaces where whitespace splits
  value = value.replace(/^"(.*)"$/s, '$1')
  if (a == 'order' && !b && op == '=') {
    return { comp: '', prop: 'order', op: ORDER, value }
  }
  if (b) {
    // The collision rule: a first segment naming a COMPONENT is the
    // explicit spelling (.pin.x); anything else walks a reference.
    if (routes[a]) {
      if (!routes[a].includes(b)) throw new Error(`no such prop: .${a}.${b}`)
      return { comp: a, prop: b, op: OPS[op], value }
    }
    let r = route(a)
    if (!r.prop.endsWith('_eid')) {
      throw new Error(`.${a} is not a reference — paths walk _eid columns`)
    }
    return { ...r, op: OPS[op], value, at: route(b) }
  }
  return { ...route(a), op: OPS[op], value }
}

// A bare word: contains over the doc, title or body. comp/prop are for
// show — matchQuery treats TEXT specially (one pred, two columns).
export let TEXT = 'text'
let text = (value: string): Pred => ({
  comp: 'doc',
  prop: '*',
  op: TEXT,
  value,
})

// A query string to preds. '&' separates first (an &-segment that IS one
// dot-param keeps its spaces — the old grammar); a segment holding ` .`
// or bare words splits on whitespace, quotes glue: that's how a search
// box mixes terms and filters in one line. Empty: matches everything.
export let parseQuery = (q: string): Pred[] =>
  q.split('&').map((t) => t.trim()).filter(Boolean).flatMap((seg) => {
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

// A timestamp row against a time phrase: the phrase names a range, the op
// picks its edge — = within, >= from the start, <= until the end, > and <
// strictly outside. Only fires when the ROW is ISO (a domain literally
// named 'today' stays a string).
let ISO = /^\d{4}-\d{2}-\d{2}T/
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

let test = (v: unknown, p: Pred): boolean => {
  if (p.op != '~' && typeof v == 'string' && ISO.test(v)) {
    let s = span(p.value)
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
let UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export let resolveRefs = (
  preds: Pred[],
  lookup: (id: string) => string | undefined,
): Pred[] =>
  preds.map((p) => {
    let target = p.at ? p.at.prop : p.prop
    if (!target.endsWith('_eid') || (p.op != '' && p.op != '!')) return p
    if (!p.value || /\.\./.test(p.value)) return p
    let value = p.value.split(',')
      .map((part) => !part || UUID.test(part) ? part : lookup(part) ?? part)
      .join(',')
    return value == p.value ? p : { ...p, value }
  })

// Does an entity satisfy every pred? A TEXT pred reads the doc itself —
// one pred, either column. A path pred dereferences through `ent` (the
// evaluator's graph); no ent, no ref, or no target reads as an absent
// value — so `.assignee.title=x` misses and `!=x` holds, same as any
// null column.
export let matchQuery = (
  c: Comps,
  preds: Pred[],
  ent?: (eid: string) => Comps | undefined,
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
    if (p.at) {
      let ref = c[p.comp]?.[p.prop]
      let t = ref ? ent?.(String(ref)) : undefined
      return test(t?.[p.at.comp]?.[p.at.prop], p)
    }
    return test(c[p.comp]?.[p.prop], p)
  })

// The warmth of an entity, on (0,1] — the rank behind '.order=hot'.
// Recall aggregates (count, first_at, last_at) are the whole model:
// every recall earns a day of STABILITY, and spacing multiplies it —
// the same count spread over months buys more durability than an
// afternoon of cramming (mean interval, in weeks, is the multiplier).
// The score decays exponentially past last_at against that stability,
// so top-of-mind-for-hours / recallable-for-days / rings-a-bell-for-
// months fall out of one curve. No recall row yet: the entity's own
// modified_at counts as a single touch — new things start hot and fade
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
      String(c.entity?.modified_at ?? c.entity?.created_at ?? ''),
    )
    if (Number.isNaN(last)) return 0
  }
  let first = Date.parse(String(r?.first_at ?? ''))
  if (Number.isNaN(first)) first = last
  let mean = count > 1 ? Math.max(0, last - first) / (count - 1) : 0
  let stability = DAY * count * (1 + mean / (7 * DAY))
  return Math.exp(-Math.max(0, now - last) / stability)
}

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
