// Suggestion: the vocabulary teaching at the point of typing. suggest() takes
// the dot-token under the caret and returns candidates, each labeled with where
// it comes from — its comp, '· stamped' when filterable but server-owned, the
// op's meaning, the enum's prop. Pure over the routing table plus the caller's
// lists (wells, entities), so one function serves the palette, the query
// editor, and every filter bar.
import { OPERATORS } from '@yaks/query'
import { isRef } from './props.ts'
import { comps, derivedProps, sessionComps } from './types.ts'
import { type Hop, ORDER } from './query.ts'
import {
  edgeish,
  groupsOf,
  NONE,
  route,
  routes,
  sharedRef,
  typed,
} from './route.ts'

// The vocabulary teaching at the point of typing: complete() takes the
// dot-token under the caret and returns candidates, each labeled with
// where it comes from — its comp, '· stamped' when filterable but
// server-owned, the op's meaning, the enum's prop. Pure over the routing
// table plus the caller's parameters (wells are the browser's suggestion
// lists, passed in), so one function serves the palette, the query
// editor, and every filter bar, and a table test can pin each segment.
export type Cand = { text: string; kind: string }

// op → its one-word meaning, the package's own table (a request `?` completes
// through presenceOps, not here).
let OP_WORDS: [string, string][] = OPERATORS.filter((o) => o.spell != '?')
  .map((o) => [o.spell, o.word])

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
      routed.length == 1 || sharedRef(p, routed)
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
  { text: base + '?', kind: 'wanted' },
  { text: base + '~=', kind: 'present' },
]

// which column a whole dotted path's LEAF names — the same resolution pred()
// does, silent instead of thrown (mid-keystroke is no place to error). null
// when a non-leaf hop isn't a reference, so the value can't be completed.
let aimPath = (path: string): Hop | null => {
  try {
    let g = groupsOf(path.split('.'), NONE)
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

export let suggest = (
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
