// The doc at a point in its history: the first `k` blocks of an order (the
// order they arrived in, or shuffled) delivered to Automerge's causal queue,
// together with every block of a writer forked at that point, which saw only
// that much. A change is applied once its deps are in and waits until then.
import { causal, key } from './feed.js'

/// let b = (actor, seq, deps = {}) => ({ eid: actor + seq, actor, change: { actor, seq, deps } })
/// let t = at([b('a', 1), b('b', 2), b('b', 1, { a: 1 })], 2)
/// [t.applied.map((x) => x.eid), t.waiting.map((c) => c.actor + c.seq)] -> [['a1'], ['b2']]
/// [...at([b('a', 1), b('a', 2), b('f', 1, { a: 1 })], 1, new Set(['f'])).phase.values()] -> ['applied', 'pending', 'applied']
/**
 * What `k` blocks of `order` rebuild: {applied, waiting, clock, phase}, where
 * `applied` holds the blocks in the order Automerge applies them, `waiting`
 * the delivered changes still held back, `clock` the last seq applied per
 * actor, and `phase` each block's eid mapped to applied, waiting or pending.
 */
export let at = (order, k, forks = new Set()) => {
  let delivered = order.filter((b, i) => i < k || forks.has(b.actor))
  let { applied, waiting } = causal(delivered.map((b) => b.change))
  let by = new Map(delivered.map((b) => [key(b.change), b]))
  let ok = new Set(applied.map(key)), held = new Set(waiting.map(key))
  let clock = {}
  for (let c of applied) clock[c.actor] = c.seq
  return {
    applied: applied.map((c) => by.get(key(c))),
    waiting,
    clock,
    phase: new Map(order.map((b) => [
      b.eid,
      ok.has(key(b.change))
        ? 'applied'
        : held.has(key(b.change))
        ? 'waiting'
        : 'pending',
    ])),
  }
}

/// needs({ actor: 'b', seq: 3, deps: { a: 2 } }, { a: 1, b: 2 }) -> [['a', 2]]
/// needs({ actor: 'b', seq: 3, deps: {} }, {}) -> [['b', 2]]
/** What a waiting change still needs, as [actor, seq] pairs not yet applied. */
export let needs = (c, clock) => [
  ...(c.seq > 1 && (clock[c.actor] ?? 0) < c.seq - 1
    ? [[c.actor, c.seq - 1]]
    : []),
  ...Object.entries(c.deps ?? {}).filter(([a, s]) => (clock[a] ?? 0) < s),
]

/// let one = (actor, seq, deps = {}) => ({ eid: actor + seq, change: { actor, seq, deps } })
/// let order = [one('b', 1, { a: 1 }), one('a', 2), one('a', 1), one('c', 1)]
/// [moment(order, 'b1'), moment(order, 'a2'), moment(order, 'a1'), moment(order, 'c1')] -> [3, 3, 3, 4]
/// moment(order, 'x') -> null
/**
 * How many blocks of `order` must be delivered for the block `eid` to be
 * applied: through the last of it and everything it depends on, its own
 * earlier changes included. Null for a block not in the order.
 */
export let moment = (order, eid) => {
  let start = order.find((b) => b.eid == eid)
  if (!start) return null
  let at = new Map(order.map((b, i) => [key(b.change), i]))
  let by = new Map(order.map((b) => [key(b.change), b.change]))
  let seen = new Set(), todo = [start.change], last = 0
  while (todo.length) {
    let c = todo.pop()
    if (!c || seen.has(key(c))) continue
    seen.add(key(c))
    last = Math.max(last, at.get(key(c)) + 1)
    todo.push(
      by.get(key({ actor: c.actor, seq: c.seq - 1 })),
      ...Object.entries(c.deps ?? {}).map(([a, s]) =>
        by.get(key({ actor: a, seq: s }))
      ),
    )
  }
  return last
}
