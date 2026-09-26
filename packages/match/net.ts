// A network of queries: the live queries on a graph merged into one structure,
// so an entity that changed is routed to the queries it can affect instead of
// being tested against each of them in turn.
//
// A query joins as the clauses of its conjunction, each compiled once
// (./clause.ts) into a node: its test, and the sets its matches lie inside. A
// node is shared by every query that asks the same thing — two watches asking
// `.health.hp>0` hold one node — and routing an entity runs a node at most
// once, however many queries hold it.
//
// A query enters the network through one of its needs, the way a regular
// expression is entered through its first character. A query needing a value
// (`.carried.by=p1`) is filed under that value: routing reads the property
// once and looks the value up, a switch rather than a chain of comparisons. A
// query needing a component is filed under the component, and an entity is
// routed only to the queries filed under the components it wears. A query
// naming ids is filed under them. A query needing nothing is tried for every
// entity. Each candidate then runs its nodes, sharing their answers.
//
// Only a question about one entity alone joins. A query that follows a
// reference, orders, windows or counts depends on other entities, so `add`
// says it cannot hold it, and the caller runs that query again instead.
//
// The network also remembers which entities each query holds, the way a Rete
// network keeps a memory beside each test: moving a changed entity through it
// answers the queries it is in now and the ones it has left, so a commit costs
// what it changed, never what is watched.

import { type And, type Clause, parse, type Query as Ast } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import { type Arm, compile, type Ctx, type Need, type Test } from './clause.ts'
import {
  type Bundle,
  type Computed,
  type Eid,
  index,
  keyOf,
  live,
} from './read.ts'

/**
 * The live queries on a graph, as one network. `K` is whatever the caller
 * keys a query by: a watch, a subscription, a rule.
 */
export type Net<K> = {
  /** Hold a query under a key, with the entities it already selects, and say
   * whether it could: `false` for a query that is not a question about one
   * entity alone, or that this package cannot compile, which the caller
   * answers by running the query again. A key held already lets go of its old
   * query either way. */
  add: (key: K, query: string | Ast, has?: Iterable<Eid>) => boolean
  /** let go of the query held under a key */
  drop: (key: K) => void
  /** the keys whose queries this entity matches, in the order they were
   * reached */
  route: (bundle: Bundle) => K[]
  /** An entity that changed, whole: the keys whose queries it matches now,
   * whether or not they held it before, and the keys that held it and no
   * longer match. A deleted entity matches nothing. */
  move: (bundle: Bundle) => { into: K[]; out: K[] }
  /** an entity no longer held anywhere: the keys that held it */
  forget: (eid: Eid) => K[]
}

/** How a network compiles its queries: the moment their time phrases resolve
 * against (default: when each is added), and the rules that read the
 * vocabulary's computed properties. */
export type NetOpts = { now?: number; computed?: Computed }

// One shared test, and its answer for the entity being routed now (`at` is
// the routing it was worked out in).
type Node = { name: string; test: Test; at: number; hit: boolean; held: number }
// One held query: its nodes, the sets it is filed in, the last routing that
// reached it (so an entity filed under two of its sets tests it once), and the
// entities it holds.
type Held<K> = {
  key: K
  nodes: Node[]
  filed: Set<Held<K>>[]
  seen: number
  has: Set<Eid>
}

// The clauses that shape an answer without deciding membership, and the ones
// that make it a question about more than one entity.
let SHAPE = new Set(['fields', 'every'])
let SET = new Set([
  'order',
  'limit',
  'after',
  'count',
  'distinct',
  'tally',
  'near',
  'edges',
])

// A conjunction's clauses, flat: `(a b) c` is three clauses.
let flat = (cs: readonly Clause[]): Clause[] =>
  cs.flatMap((c) => c.kind == 'and' ? flat(c.clauses) : [c])

// The set a query is filed under: a value where it names one (the smallest set
// an entity can reach it through), then an id list, then a component.
let entry = (needs: Need[]): Need | undefined =>
  needs.find((n) => 'keys' in n) ?? needs.find((n) => 'eids' in n) ??
    needs[0]

let into = <A, B>(m: Map<A, B>, k: A, make: () => B): B => {
  let v = m.get(k)
  if (v === undefined) m.set(k, v = make())
  return v
}

/**
 * A network over one vocabulary. Every query in it compiles with the same
 * options.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { loadVocab } from '@yaks/vocab'
 *
 * let hp = { type: 'number' }
 * let vocab = loadVocab([{
 *   $defs: {
 *     health: { component: true, properties: { hp } },
 *     creature: { component: true, properties: { kind: { type: 'string' } } },
 *   },
 * }])
 * let watching = net<string>(vocab)
 * watching.add('alive', '.creature&.health.hp>0')
 * watching.add('slimes', '.creature.kind=slime&.health.hp>0')
 * watching.add('hurt', '.health.hp<5')
 * let boar = {
 *   entity: { eid: 'c1' },
 *   creature: { kind: 'boar' },
 *   health: { hp: 3 },
 * }
 * assertEquals(watching.route(boar).sort(), ['alive', 'hurt'])
 * ```
 */
export let net = <K>(vocab: Vocab, opts: NetOpts = {}): Net<K> => {
  let nodes = new Map<string, Node>()
  let held = new Map<K, Held<K>>()
  let byComp = new Map<string, Set<Held<K>>>()
  let byKey = new Map<string, Map<string, Map<string, Set<Held<K>>>>>()
  let byEid = new Map<string, Set<Held<K>>>()
  let open = new Set<Held<K>>()
  // For each entity some query holds, the queries that hold it.
  let within = new Map<Eid, Set<Held<K>>>()
  let stamp = 0

  // One clause compiled, and the name its node is shared under: the clause
  // itself, and the moment it was compiled for when its test read the clock.
  let compiled = (c: Clause): { name: string; arm: Arm } => {
    let now = opts.now ?? Date.now()
    let timed = false
    let ctx: Ctx = {
      v: vocab,
      get now() {
        timed = true
        return now
      },
      computed: opts.computed ?? {},
    }
    let arm = compile(ctx, c)
    return { name: JSON.stringify(c) + (timed ? `@${now}` : ''), arm }
  }

  let join = (h: Held<K>, eid: Eid) => {
    h.has.add(eid)
    into(within, eid, () => new Set()).add(h)
  }
  let leave = (h: Held<K>, eid: Eid) => {
    h.has.delete(eid)
    let at = within.get(eid)
    if (at?.delete(h) && !at.size) within.delete(eid)
  }

  let drop = (key: K) => {
    let h = held.get(key)
    if (!h) return
    held.delete(key)
    for (let set of h.filed) set.delete(h)
    for (let n of h.nodes) if (--n.held == 0) nodes.delete(n.name)
    for (let eid of [...h.has]) leave(h, eid)
  }

  let add = (key: K, query: string | Ast, has: Iterable<Eid> = []): boolean => {
    let q: And = typeof query == 'string' ? parse(query) : query
    drop(key)
    let cs = flat(q.clauses).filter((c) => !SHAPE.has(c.kind))
    if (cs.some((c) => SET.has(c.kind))) return false
    let made: { name: string; arm: Arm }[]
    try {
      made = cs.map(compiled)
    } catch {
      return false
    }
    if (made.some((m) => !m.arm.alone)) return false
    let h: Held<K> = { key, nodes: [], filed: [], seen: 0, has: new Set() }
    for (let { name, arm } of made) {
      let n = into(nodes, name, () => ({
        name,
        test: arm.test,
        at: 0,
        hit: false,
        held: 0,
      }))
      if (h.nodes.includes(n)) continue
      n.held++
      h.nodes.push(n)
    }
    let file = (set: Set<Held<K>>) => {
      set.add(h)
      h.filed.push(set)
    }
    let need = entry(made.flatMap((m) => m.arm.needs))
    if (!need) file(open)
    else if ('keys' in need) {
      let props = into(byKey, need.comp, () => new Map())
      let values = into(props, need.prop, () => new Map())
      for (let k of need.keys) file(into(values, k, () => new Set()))
    } else if ('eids' in need) {
      for (let eid of need.eids) file(into(byEid, eid, () => new Set()))
    } else file(into(byComp, need.comp, () => new Set()))
    held.set(key, h)
    for (let eid of has) join(h, eid)
    return true
  }

  // The queries an entity matches.
  let reach = (b: Bundle): Held<K>[] => {
    if (!live(b)) return []
    let at = ++stamp
    let among = index([b])
    let out: Held<K>[] = []
    let visit = (set: Set<Held<K>> | undefined) => {
      if (!set) return
      next: for (let h of set) {
        if (h.seen == at) continue
        h.seen = at
        for (let n of h.nodes) {
          if (n.at != at) {
            n.at = at
            n.hit = n.test(b, among)
          }
          if (!n.hit) continue next
        }
        out.push(h)
      }
    }
    for (let name in b) {
      if (name == 'entity' || name[0] == '$') continue
      visit(byComp.get(name))
      let props = byKey.get(name)
      if (!props) continue
      let c = b[name] as Record<string, unknown> | null
      for (let [prop, values] of props) {
        let k = keyOf(c?.[prop])
        if (k !== undefined) visit(values.get(k))
      }
    }
    visit(byEid.get(b.entity.eid))
    visit(open)
    return out
  }

  let move = (b: Bundle): { into: K[]; out: K[] } => {
    let eid = b.entity.eid
    let now = reach(b)
    let out: K[] = []
    for (let h of within.get(eid) ?? []) {
      if (now.includes(h)) continue
      out.push(h.key)
      leave(h, eid)
    }
    for (let h of now) join(h, eid)
    return { into: now.map((h) => h.key), out }
  }

  let forget = (eid: Eid): K[] => {
    let was = [...within.get(eid) ?? []]
    for (let h of was) leave(h, eid)
    return was.map((h) => h.key)
  }

  let route = (b: Bundle): K[] => reach(b).map((h) => h.key)

  return { add, drop, route, move, forget }
}
