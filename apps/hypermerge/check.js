// What a tab trusts of a feed, as hypercore's replication did: a block counts
// once it is the feed's own (its change's actor and seq match its place), its
// eid is the SHA-256 of its bytes, and its signature verifies, under the
// feed's key, the tree hash over the feed up to it. A feed is trusted from
// its first block up to the first that fails or is missing.
import { verify } from './keys.js'
import { bytes, hex, sha256 } from './pack.js'
import { indexed, leaf, nodes, treeHash } from './tree.js'

let leaves = new Map(), verdicts = new Map()

let leafOf = (b) => {
  if (!leaves.has(b.eid)) {
    let data = bytes(b.change)
    leaves.set(b.eid, { data, ...leaf(data) })
  }
  return leaves.get(b.eid)
}

// Whether a block is its feed's own, signed over the tree with `before`
// (the trusted leaves ahead of it), remembered by eid: a block's place and
// predecessors never change once it is trusted.
let sound = (doc, lane, b, before) => {
  if (!verdicts.has(b.eid)) {
    verdicts.set(
      b.eid,
      (async () => {
        let l = leafOf(b)
        if (
          b.doc != doc || b.change?.actor != lane.actor ||
          b.change?.seq != b.index + 1 || await sha256(l.data) != b.eid
        ) return 'forged'
        let tree = treeHash(indexed(nodes([...before, l])), before.length + 1)
        return await verify(lane.actor, b.sig, tree) ? 'ok' : 'unsigned'
      })(),
    )
  }
  return verdicts.get(b.eid)
}

/**
 * A lane's trust: {trusted, status, nodes, tree}. `trusted` is the longest
 * verified run of blocks from index 0, `status` maps every block's eid to ok,
 * forged, unsigned or gap, and `nodes` and `tree` are the Merkle tree over
 * the trusted blocks and its hash, in hex.
 */
export let checked = async (doc, lane) => {
  let trusted = [], status = new Map(), before = []
  for (let b of lane.blocks) {
    if (b.index != trusted.length) {
      status.set(b.eid, b.index < trusted.length ? 'forged' : 'gap')
      continue
    }
    let v = await sound(doc, lane, b, before)
    status.set(b.eid, v)
    if (v == 'ok') {
      trusted.push(b)
      before.push(leafOf(b))
    }
  }
  let all = nodes(before)
  return {
    trusted,
    status,
    nodes: all,
    tree: before.length ? hex(treeHash(indexed(all), before.length)) : null,
  }
}

/** A block's leaf hash, in hex. */
export let leafHash = (b) => hex(leafOf(b).hash)
