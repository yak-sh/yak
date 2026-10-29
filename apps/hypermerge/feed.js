// A doc's rows as hypermerge kept them: an actor set, and one feed per actor
// whose blocks are that actor's changes in order. The root feed, whose key
// is the doc's id, comes first.

/// let block = (actor, index) => ({ block: { actor, index } })
/// let order = (ls) => ls.map((l) => [l.actor, l.blocks.map((b) => b.index)])
/// order(lanes('a', [block('b', 0), block('a', 1), block('a', 0)])) -> [['a', [0, 1]], ['b', [0]]]
/// order(lanes('a', [{ actor: { key: 'c' } }, block('b', 0)])) -> [['a', []], ['c', []], ['b', [0]]]
export let lanes = (doc, rows) => {
  let by = new Map([[doc, { actor: doc, blocks: [] }]])
  let lane = (key) =>
    by.get(key) ?? by.set(key, { actor: key, blocks: [] }).get(key)
  for (let r of rows) {
    if (r.actor) Object.assign(lane(r.actor.key), { member: r.actor })
  }
  for (let r of rows) {
    if (r.block) {
      lane(r.block.actor).blocks.push({ ...r.block, eid: r.entity?.eid })
    }
  }
  for (let l of by.values()) l.blocks.sort((x, y) => x.index - y.index)
  return [...by.values()]
}

/// key({ actor: 'a', seq: 2 }) -> 'a:2'
/** A change's place: its actor's feed and its seq there. */
export let key = ({ actor, seq }) => `${actor}:${seq}`

/// let c = (actor, seq, deps = {}) => ({ actor, seq, deps })
/// causal([c('b', 1, { a: 1 }), c('a', 1)]).applied.map(key) -> ['a:1', 'b:1']
/// causal([c('a', 2), c('b', 1, { a: 2 })]).waiting.map(key) -> ['a:2', 'b:1']
/**
 * What Automerge's causal queue does with changes delivered in this order: a
 * change is applied once its actor's previous seq and every dep are in, and
 * waits until then. Answers {applied, waiting}, applied in the order applied.
 */
export let causal = (changes) => {
  let clock = {}, applied = [], waiting = [...changes]
  let ready = (c) =>
    (clock[c.actor] ?? 0) == c.seq - 1 &&
    Object.entries(c.deps).every(([a, s]) => (clock[a] ?? 0) >= s)
  for (let i = waiting.findIndex(ready); i >= 0; i = waiting.findIndex(ready)) {
    let [c] = waiting.splice(i, 1)
    clock[c.actor] = c.seq
    applied.push(c)
  }
  return { applied, waiting }
}

/// shuffled([1, 2, 3], () => 0) -> [2, 3, 1]
/** A copy in random order (Fisher–Yates), `random` giving numbers in [0, 1). */
export let shuffled = (xs, random = Math.random) => {
  let out = [...xs]
  for (let i = out.length - 1; i > 0; i--) {
    let j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
