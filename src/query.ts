// The FILTER grammar — dot-params in URL query-param form. One parser for
// every reader: a board's saved query, `task list`, MCP task_list. (Writes
// keep the plain `.prop=value` setter grammar in client.ts — a setter's
// comma is a literal comma; only filters interpret value forms.)
//
//   .status=open&.priority<=1&.domain=Ops,Eng
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
// Unqualified props route by component, same rule as writes; `.task.status`
// is the explicit spelling. `.num` and friends route to the entity spine.
import { comps } from './types.ts'

export type Pred = {
  comp: string
  prop: string
  op: string
  value: string
}

// What a pred evaluates against: an entity's components, merged — the
// shape of both a live-cache row and a client Row's `.comps`.
type Comps = Record<string, Record<string, unknown> | undefined>

// The routing table: every component's columns, plus the spine's.
let routes: Record<string, readonly string[]> = {
  ...comps,
  entity: ['num', 'created_at', 'modified_at'],
}

// Route a bare prop to its component; ambiguity is an error that names
// the candidates rather than a guess.
export let routeProp = (prop: string): string => {
  let hits = Object.entries(routes)
    .filter(([, cols]) => cols.includes(prop))
    .map(([name]) => name)
  if (hits.length == 1) return hits[0]
  if (!hits.length) throw new Error(`unknown prop: .${prop}`)
  throw new Error(
    `.${prop} is ambiguous (${hits.join(', ')}) — use .${hits[0]}.${prop}`,
  )
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

export let pred = (token: string): Pred | null => {
  let m = token.match(
    /^\.([A-Za-z_]+)(?:\.([A-Za-z_]+))?(!=|~=|<=|>=|<|>|=)(.*)$/s,
  )
  if (!m) return null
  let [, a, b, op, value] = m
  if (b && !routes[a]?.includes(b)) throw new Error(`no such prop: .${a}.${b}`)
  return b
    ? { comp: a, prop: b, op: OPS[op], value }
    : { comp: routeProp(a), prop: a, op: OPS[op], value }
}

// '&'-joined tokens to preds. Empty query: no preds, matches everything.
export let parseQuery = (q: string): Pred[] =>
  q.split('&').map((t) => t.trim()).filter(Boolean).map((t) => {
    let p = pred(t)
    if (!p) throw new Error(`not a filter: ${t}`)
    return p
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

let test = (v: unknown, p: Pred): boolean => {
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

// Does an entity satisfy every pred?
export let matchQuery = (c: Comps, preds: Pred[]) =>
  preds.every((p) => test(c[p.comp]?.[p.prop], p))

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
