// Declared rules, evaluated over the map. A rule is a query (@yaks/graph's
// join.ts parses it into a plan of patterns, one per entity), and @yaks/sqlite
// answers one by compiling the plan into a statement. This is the same answer
// worked out in memory: each pattern's filter is an ordinary query that
// @yaks/match answers over the store's own indexes, and what is left is the
// join, every pattern's entity and the values its variables took, kept where
// the variables agree.
//
// The store folds the change in before asking (./store.ts `bindings`), so what
// this file is handed is the graph as the change would leave it, the entities
// the change is about, and what it removed. The first is the source a filter
// reads; the second is the anchor, since a rule is about a change and not the
// whole graph: at least one of its patterns binds an entity the change wrote,
// so a gated rule does not fire on every entity that ever failed its gate. The
// third answers `-comp`, the one clause no row can answer.
//
// The anchor is also the plan. An anchored pattern is read from the change
// alone, and each pattern after it is found through what the ones before it
// bound: its entity by id, or its property through the store's keyed index.
// A keystroke's change is one entity, so a rule over it reads a handful of
// bundles, however large the page's graph.

import type { Bind, Binding, Eid, Match, Pattern } from '@yaks/graph'
import { collected } from '@yaks/graph'
import {
  type Bundle,
  filter,
  type Index,
  keyOf,
  matcher,
  type MatchOpts,
} from '@yaks/match'
import type { Vocab } from '@yaks/vocab'

// Where a variable is filled from: an `id` (a pattern's entity, or a
// reference) or a plain `value`, and how to read it off a bundle. A slot on one
// stored property of the bundle itself names it, so a join can look the value
// up in the keyed index instead of reading every candidate.
type Slot = {
  kind: 'id' | 'value'
  read: (b: Bundle, x: Index) => unknown
  at?: [comp: string, prop: string]
}

// One property, as a read of a bundle: its computed rule where the vocabulary
// derives it, else what the bundle holds.
let reader = (comp: string, prop: string, opts: MatchOpts) => {
  let computed = opts.computed?.[`${comp}.${prop}`]
  return (b: Bundle | undefined): unknown =>
    !b
      ? null
      : computed
      ? computed(b)
      : (b[comp] as Record<string, unknown> | undefined)?.[prop] ?? null
}

// A bound property, followed through the references before its leaf.
let slot = (v: Vocab, bind: Bind, opts: MatchOpts): Slot => {
  let path = bind.path.join('.')
  let hops = v.aim(path)
  let leaf = hops[hops.length - 1]
  if (!leaf?.prop) throw new Error(`$${bind.name} names no property: .${path}`)
  let prop = v.prop(leaf.comp, leaf.prop)
  if (!prop) throw new Error(`no property ${leaf.comp}.${leaf.prop}`)
  let reads = hops.map((h) => reader(h.comp, h.prop, opts))
  let kind: Slot['kind'] = prop.category == 'ref' ? 'id' : 'value'
  if (hops.length == 1) {
    let at: Slot['at'] = prop.computed ? undefined : [leaf.comp, leaf.prop]
    return { kind, read: reads[0], at }
  }
  return {
    kind,
    read: (b, x) => {
      let at: Bundle | undefined = b
      for (let r of reads.slice(0, -1)) {
        let eid = r(at)
        at = typeof eid == 'string' ? x.of(eid) : undefined
      }
      return reads[reads.length - 1](at)
    },
  }
}

let eidOf = (b: Bundle) => b.entity.eid

// One pattern, compiled once per evaluation: the entities it selects, the test
// for one candidate, and its variables' slots. A bound property implies its
// component is worn, and a gate that it is not, as the SQL a pattern compiles
// to joins the one and left-joins the other.
let compiled = (p: Pattern, v: Vocab, opts: MatchOpts) => {
  let select = matcher(p.filter, v, opts)
  let test = filter(p.filter, v, opts)
  let worn = p.binds.map((b) => v.aim(b.path.join('.'))[0].comp)
  let fits = (b: Bundle) =>
    worn.every((c) => b[c] != null) && p.gates.every((c) => b[c] == null)
  let slots: [string, Slot][] = p.binds.map((b) => [b.name, slot(v, b, opts)])
  if (p.entity) slots.unshift([p.entity, { kind: 'id', read: eidOf }])
  return {
    entity: p.entity,
    slots,
    all: (x: Index) => select(x).filter(fits),
    one: (b: Bundle | undefined, x: Index): b is Bundle =>
      !!b && test(b, x) && fits(b),
  }
}

type Compiled = ReturnType<typeof compiled>
type Vars = Record<string, unknown>

// A candidate's variables joined to the ones already bound, or null where one
// disagrees. A variable is the same value in every slot, and nothing equals an
// absent one, as in SQL; values compare as a keyed index files them.
let joined = (slots: [string, Slot][], b: Bundle, x: Index, vars: Vars) => {
  let out = vars
  for (let [name, s] of slots) {
    let value = s.read(b, x)
    if (name in out) {
      if (value == null || keyOf(value) !== keyOf(out[name])) return null
      continue
    }
    if (out === vars) out = { ...vars }
    out[name] = value
  }
  return out
}

// One flat level of a match: its patterns joined, anchored to the change when
// `anchor` is given.
let level = (
  plan: Match,
  x: Index,
  anchor: ReadonlySet<Eid> | undefined,
  v: Vocab,
  opts: MatchOpts,
): Binding[] => {
  let pats = plan.patterns.map((p) => p.makes ? null : compiled(p, v, opts))
  // An id and a value are not comparable, so a variable that is an entity in
  // one place and a plain value in another is refused rather than coerced.
  let kinds = new Map<string, Slot['kind']>()
  for (let [name, s] of pats.flatMap((p) => p?.slots ?? [])) {
    if ((kinds.get(name) ?? s.kind) != s.kind) {
      throw new Error(
        `$${name} is an entity in one place and a plain value in another`,
      )
    }
    kinds.set(name, s.kind)
  }
  let live = pats.flatMap((p, i) => p ? [i] : [])
  if (anchor && !live.length) return []
  let out: Binding[] = []
  let seen = new Set<string>()
  let entities: (Eid | null)[] = plan.patterns.map(() => null)
  // What a pattern could bind, given what the patterns before it bound.
  let found = (p: Compiled, vars: Vars): Iterable<Bundle | undefined> => {
    let eid = p.entity && vars[p.entity]
    if (eid != null) return [x.of(String(eid))]
    for (let [name, s] of p.slots) {
      let key = s.at && keyOf(vars[name])
      if (key !== undefined && s.at && x.keyed) {
        return x.keyed(s.at[0], s.at[1], key).values()
      }
    }
    return p.all(x)
  }
  let walk = (
    order: number[],
    at: number,
    vars: Vars,
    first?: Iterable<Eid>,
  ) => {
    if (at == order.length) {
      let row = {
        entities: [...entities],
        vars: Object.fromEntries(plan.vars.map((n) => [n, vars[n] ?? null])),
      }
      let key = JSON.stringify(row)
      if (seen.has(key)) return
      seen.add(key)
      out.push(row)
      return
    }
    let i = order[at]
    let p = pats[i]!
    let from = first ? [...first].map((eid) => x.of(eid)) : found(p, vars)
    for (let b of from) {
      if (!p.one(b, x)) continue
      let next = joined(p.slots, b, x, vars)
      if (!next) continue
      entities[i] = b.entity.eid
      walk(order, at + 1, next)
    }
    entities[i] = null
  }
  // Anchored, each pattern in turn is the one read from the change and the rest
  // are found through it; a row two turns both find is kept once.
  let orders = anchor
    ? live.map((k) => [k, ...live.filter((i) => i != k)])
    : [live]
  for (let order of orders) walk(order, 0, {}, anchor)
  return out
}

/**
 * Evaluate declared rules' matches over a source (@yaks/graph `Tx.bindings`):
 * each match's bindings, with its collections attached. `anchor` is the set of
 * entities the change is about, which every outer binding must touch; left out,
 * the match is asked outright, as a template's invocation asks it.
 */
export let bindings = (
  matches: Match[],
  x: Index,
  anchor: ReadonlySet<Eid> | undefined,
  v: Vocab,
  opts: MatchOpts = {},
): Binding[][] =>
  matches.map((m) =>
    collected(
      m,
      (plan, anchored) =>
        level(plan, x, anchored ? anchor : undefined, v, opts),
    )
  )
