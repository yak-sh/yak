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
import { comps, type PropType, stamped } from './types.ts'

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
  // Several comps sharing a ref name (actor_eid on client AND session)
  // stay one CONCEPT: comp '' means any-of, and matchQuery scans every
  // comp for the prop. Writes can't aim at "any" — param() rejects the
  // bare form and asks for the explicit spelling.
  if (ref.length > 1) return { comp: '', prop: `${prop}_eid` }
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
      let ref = read(c, p.comp, p.prop)
      let t = ref ? ent?.(String(ref)) : undefined
      return test(t && read(t, p.at.comp, p.at.prop), p)
    }
    return test(read(c, p.comp, p.prop), p)
  })

// One column read, honoring route()'s any-of: comp '' means the prop is
// a shared ref name (actor_eid), so take the first value any comp holds
// — an entity carries at most one of the sharing comps in practice.
let read = (c: Comps, comp: string, prop: string) =>
  comp ? c[comp]?.[prop] : Object.values(c).map((v) => v?.[prop])
    .find((v) => v != null)

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

let typeOf = (comp: string, prop: string): PropType | undefined =>
  comp
    ? comps[comp]?.[prop] ?? stamped[comp]?.[prop]
    : Object.values(comps).find((m) => prop in m)?.[prop]

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
    : at.prop.endsWith('_at')
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
    return OP_WORDS.filter(([op]) => op.startsWith(half[2]))
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
  return [
    ...pre && tryRoute(pre) ? opsFor(`.${pre}`) : [],
    ...Object.keys(routes).filter((c) => starts(c, pre)).toSorted()
      .map((c) => ({ text: `.${c}.`, kind: 'comp' })),
    ...bares().filter((c) =>
      starts(c.text.slice(1), pre) && c.text.slice(1) != pre
    ),
    ...starts(ORDER, pre) ? [{ text: '.order=hot', kind: 'rank' }] : [],
  ]
}
