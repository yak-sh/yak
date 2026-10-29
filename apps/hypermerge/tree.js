// Hypercore's Merkle tree over one feed, in flat-tree order: block i is node
// 2i, and each parent sits at the odd index between its two children, so a
// node's index is also its place from left to right. Every hash is BLAKE2b-256
// with hypercore's type byte in front: 0 for a block, 1 for a parent, 2 for
// the tree hash over the roots, which is what the feed's owner signs.
import blake from 'blakejs'

let u64 = (n) => {
  let b = new Uint8Array(8)
  new DataView(b.buffer).setBigUint64(0, BigInt(n))
  return b
}
let hash = (...parts) => {
  let all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  parts.reduce((at, p) => (all.set(p, at), at + p.length), 0)
  return blake.blake2b(all, undefined, 32)
}

/// [index(0, 0), index(0, 3), index(1, 0), index(1, 1), index(2, 0)] -> [0, 6, 1, 5, 3]
/** The flat-tree index of the node at `depth` and `offset` (0 is a block). */
export let index = (depth, offset) => offset * 2 ** (depth + 1) + 2 ** depth - 1

/// roots(1) -> [0]
/// roots(3) -> [1, 4]
/// roots(6) -> [3, 9]
/** The indexes of the full subtrees whose roots cover `n` blocks. */
export let roots = (n) => {
  let out = [], start = 0
  for (let d = 31; d >= 0; d--) {
    if (n & 2 ** d) {
      out.push(index(d, start / 2 ** d))
      start += 2 ** d
    }
  }
  return out
}

/** A block's leaf: its size and BLAKE2b hash. */
export let leaf = (data) => ({
  size: data.length,
  hash: hash(Uint8Array.of(0), u64(data.length), data),
})

/// let one = leaf(Uint8Array.of(1))
/// nodes([one, one, one]).map((n) => [n.index, n.depth, n.size]) -> [[0, 0, 1], [2, 0, 1], [4, 0, 1], [1, 1, 2]]
/**
 * Every node a feed of these leaves stores, leaves first: {index, depth, hash,
 * size}, where size is the bytes beneath it.
 */
export let nodes = (leaves) => {
  let level = leaves.map((l, i) => ({ ...l, index: 2 * i, depth: 0 }))
  let all = [...level]
  for (let d = 1; level.length > 1; d++) {
    let up = []
    for (let o = 0; o + 1 < level.length; o += 2) {
      let [a, b] = [level[o], level[o + 1]]
      up.push({
        index: index(d, o / 2),
        depth: d,
        size: a.size + b.size,
        hash: hash(Uint8Array.of(1), u64(a.size + b.size), a.hash, b.hash),
      })
    }
    all.push(...up)
    level = up
  }
  return all
}

/** The tree hash once the first `n` blocks are in: what block n - 1 is signed over. */
export let treeHash = (byIndex, n) =>
  hash(
    Uint8Array.of(2),
    ...roots(n).flatMap((i) => {
      let r = byIndex.get(i)
      return [r.hash, u64(r.index), u64(r.size)]
    }),
  )

/** The nodes keyed by their flat-tree index. */
export let indexed = (all) => new Map(all.map((n) => [n.index, n]))
