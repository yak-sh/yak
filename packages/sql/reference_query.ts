// Repeated scalar identity queries share their lowering, with every operand
// bound anew. Other query forms retain the ordinary compiler. A cold plan is
// proven by changing every operand: SQL must stay identical, every parameter
// must follow an operand, and every operand must reach a parameter.
import { type And, type Clause, map, type Pred } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import { type Param, type Raw, raw, type Stmt } from './ast.ts'
import { type BindOpts, prepared } from './bind.ts'
import { derivedOf, idOf } from './derived.ts'
import { identity } from './ident.ts'
import { render } from './render.ts'

type Value = string | number | null
type Inputs = { key: string; eids: string[]; values: Value[] }
type Plan = { sql: string; slots: number[]; origin: (values: Value[]) => Stmt }
let plans = new WeakMap<Vocab, Map<string, Plan | null>>()
let generated = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$|^[0-9a-f]{40,64}$/i

let inputs = (ast: And, v: Vocab, o: BindOpts): Inputs | undefined => {
  if (o.visibility || o.eids) return
  if (o.extend?.some((e) => e.compile.pred || e.compile.and || e.compile.or)) {
    return
  }
  let eids: string[] = [], values: Value[] = []
  let eid = new Map<string, number>(), value = new Map<Value, number>()
  let index = <T>(map: Map<T, number>, list: T[], item: T): number => {
    let i = map.get(item)
    if (i === undefined) {
      map.set(item, i = list.length)
      list.push(item)
    }
    return i
  }
  let derived = derivedOf(v, o.derived)
  let leaf = (c: Clause): unknown[] | undefined => {
    if (
      c.kind != 'pred' || c.op != '=' || c.not || c.where || c.path.length != 2
    ) return
    let scalar = c.value?.kind == 'list' && c.value.items.length == 1
      ? c.value.items[0]
      : c.value
    if (scalar?.kind != 'scalar' || !generated.test(scalar.raw)) return
    let hops = v.aim(c.path.join('.'))
    let h = hops[0]
    if (
      hops.length != 1 || !h.prop || derived[`${h.comp}.${h.prop}`] ||
      v.comp(h.comp)?.computed
    ) return
    let own = h.comp == 'entity' && h.prop == 'eid'
    let p = v.prop(h.comp, h.prop)
    if (own) {
      if (identity('eid', scalar, o.exactIds)?.nums.length) return
      if (
        Object.values(o.backed ?? {}).some((b) =>
          b.tag && idOf(b.tag, scalar.raw) != null
        )
      ) return
    } else if (
      p?.category != 'ref' || p.computed || p.ref && v.comp(p.ref)?.computed
    ) return
    let resolved = !own && Object.hasOwn(o.references ?? {}, scalar.raw)
    let binding = resolved ? o.references![scalar.raw] : scalar.raw
    if (resolved && binding !== null && !Number.isSafeInteger(binding)) return
    return [
      c.path,
      c.value!.kind,
      index(eid, eids, scalar.raw),
      resolved,
      binding === null ? 'null' : typeof binding,
      index(value, values, binding),
    ]
  }
  let conjunction = (c: Clause): Clause[] =>
    c.kind == 'and' ? c.clauses.flatMap(conjunction) : [c]
  let children = conjunction(ast)
  let alternatives = children.length == 1 && children[0].kind == 'or'
  let parts = alternatives
    ? children[0].kind == 'or' ? children[0].clauses : []
    : children
  if (!parts.length) return
  let leaves = new Map<Clause, unknown[]>()
  for (let part of parts) {
    let cs = conjunction(part)
    if (alternatives && cs.length != 1) return
    for (let c of cs) {
      let shape = leaf(c)
      if (!shape) return
      leaves.set(c, shape)
    }
  }
  let shape = (c: Clause): unknown =>
    c.kind == 'and' || c.kind == 'or'
      ? [c.kind, ...c.clauses.map(shape)]
      : leaves.get(c)
  return {
    key: JSON.stringify([
      !!o.storageOrder,
      !!o.exactIds,
      o.archetypes?.held ?? null,
      shape(ast),
    ]),
    eids,
    values,
  }
}

// Rebind the retained structural origin as well as the statement's parameters.
// Every answer owns its tree and arrays, including branches with no operand.
let origin = (stmt: Stmt, markers: Map<Param, number>): Plan['origin'] => {
  type Make = (values: Value[]) => unknown
  let visit = (node: unknown): Make | undefined => {
    if (!node || typeof node != 'object') return
    if (Array.isArray(node)) {
      let makers = node.map(visit)
      return (values) => node.map((n, i) => makers[i]?.(values) ?? n)
    }
    let n = node as Record<string, unknown>
    let fields = Object.entries(n).flatMap(([key, part]) => {
      let make: Make | undefined
      if (n.t == 'raw' && key == 'params' && Array.isArray(part)) {
        let slots = part.map((p) => markers.get(p))
        make = (values) =>
          part.map((p, i) => slots[i] === undefined ? p : values[slots[i]!])
      } else if (n.t == 'val' && key == 'v' && markers.has(part as Param)) {
        make = (values) => values[markers.get(part as Param)!]
      } else make = visit(part)
      return make ? [[key, make] as const] : []
    })
    return (values) =>
      Object.assign(
        { ...n },
        Object.fromEntries(fields.map(([key, make]) => [key, make(values)])),
      )
  }
  let make = visit(stmt)
  return (values) => (make?.(values) ?? stmt) as Stmt
}

let probe = (ast: And, o: BindOpts, input: Inputs) => {
  let used = new Set<Value>([...input.eids, ...input.values])
  let ordinal = 0
  let named = new Map(input.eids.map((eid) => {
    let marker: string
    do marker = `00000000-0000-0000-0000-${
      (++ordinal).toString(16).padStart(12, '0')
    }`
    while (used.has(marker))
    used.add(marker)
    return [eid, marker]
  }))
  let integer = Number.MIN_SAFE_INTEGER
  let markers = input.values.map((value) => {
    if (typeof value == 'string') return named.get(value)!
    while (used.has(integer)) integer++
    used.add(integer)
    return integer++
  })
  let references = Object.fromEntries(input.eids.flatMap((eid) => {
    if (!Object.hasOwn(o.references ?? {}, eid)) return []
    let i = input.values.indexOf(o.references![eid])
    return i < 0 ? [] : [[named.get(eid)!, markers[i] as number]]
  }))
  let query = map(ast, (c) => {
    if (c.kind != 'pred') return c
    let p = c as Pred
    let value = p.value?.kind == 'list' ? p.value.items[0] : p.value
    if (value?.kind != 'scalar') return c
    let scalar = {
      kind: 'scalar' as const,
      raw: named.get(value.raw)!,
    }
    return {
      ...p,
      value: p.value?.kind == 'list'
        ? { kind: 'list', items: [scalar] }
        : scalar,
    }
  })
  return { query, markers, references }
}

export let referenceQuery = (
  ast: And,
  v: Vocab,
  o: BindOpts,
): Raw | undefined => {
  let input: Inputs | undefined
  try {
    input = inputs(ast, v, o)
  } catch {
    return
  }
  if (!input) return
  let consulted = false
  let hear = () => {
    consulted = true
  }
  let query = prepared(ast, v, o, undefined, [], undefined, hear)
  let current: Inputs | undefined
  try {
    current = inputs(ast, v, query.opts)
  } catch {
    return render(query.lower())
  }
  if (query.spine || !current || current.key != input.key) {
    return render(query.lower())
  }
  let cache = plans.get(v)
  if (!cache) plans.set(v, cache = new Map())
  let held = cache.get(input.key)
  if (held) {
    return raw(
      held.sql,
      held.slots.map((i) => current.values[i]),
      undefined,
      held.origin(current.values),
    )
  }
  let result = render(query.lower())
  if (held === null) return result
  let plan: Plan | null = null
  if (!consulted) {
    let { query: markerQuery, markers, references } = probe(
      ast,
      query.opts,
      current,
    )
    let changed = render(
      prepared(
        markerQuery,
        v,
        { ...query.opts, references, extend: [] },
        undefined,
        [],
        undefined,
        hear,
      ).lower(),
    )
    let indices = new Map<Param, number>(markers.map((m, i) => [m, i]))
    let slots = changed.params.map((m, i) => {
      let slot = indices.get(m)
      return slot !== undefined && result.params[i] === current.values[slot] &&
          result.params[i] !== m
        ? slot
        : -1
    })
    if (
      !consulted && result.sql == changed.sql &&
      result.params.length == slots.length &&
      slots.every((i) => i >= 0) &&
      new Set(slots).size == current.values.length && changed.origin
    ) {
      plan = {
        sql: changed.sql,
        slots,
        origin: origin(changed.origin, indices),
      }
    }
  }
  if (cache.size >= 128) cache.delete(cache.keys().next().value!)
  cache.set(input.key, plan)
  return result
}
