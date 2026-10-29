// One editor: an actor appending to its own feed of one doc. It keeps its own
// Automerge doc, which changes it has applied, its feed's leaves (to sign each
// new tree hash), and, while offline, the blocks it made and has not
// published. Every block it makes goes to `publish`; every block it learns of
// comes through `receive`. The store between them is the only transport.
import Automerge from 'automerge'
import { key } from './feed.js'
import { sign } from './keys.js'
import { bytes, sha256 } from './pack.js'
import { indexed, leaf, nodes, treeHash } from './tree.js'

export let editor = (doc, actor, publish) => {
  let state = Automerge.init(actor.id)
  let seen = new Set(), own = [], held = [], online = true, seq = 0
  let queue = Promise.resolve()

  // Sign and send in the order the changes were made.
  let send = (change) =>
    queue = queue.then(async () => {
      let data = bytes(change)
      own[change.seq - 1] = leaf(data)
      let row = {
        entity: { eid: await sha256(data) },
        block: {
          doc,
          actor: actor.id,
          index: change.seq - 1,
          change,
          sig: await sign(actor, treeHash(indexed(nodes(own)), change.seq)),
        },
      }
      if (online) await publish([row])
      else held.push(row)
    })

  return {
    actor,
    get state() {
      return state
    },
    get online() {
      return online
    },
    get held() {
      return held
    },
    // How many changes this actor has made: its log's length once shared.
    get seq() {
      return seq
    },
    // Settles once every change made so far is signed and sent or held.
    sent: () => queue,
    // Make one change; answers whether there was one to make.
    change(message, fn) {
      let next = Automerge.change(state, message, fn)
      let [made] = Automerge.getChanges(state, next)
      if (!made) return false
      state = next
      seq = made.seq
      seen.add(key(made))
      send(made)
      return true
    },
    // Apply the trusted blocks this editor has not seen; answers whether any
    // were new. An offline editor hears nothing.
    receive(blocks) {
      if (!online) return false
      for (let b of blocks) {
        if (b.actor == actor.id && !own[b.index]) {
          own[b.index] = leaf(bytes(b.change))
          seq = Math.max(seq, b.index + 1)
        }
      }
      let fresh = blocks.filter((b) => !seen.has(key(b.change)))
      if (!fresh.length) return false
      state = Automerge.applyChanges(state, fresh.map((b) => b.change))
      for (let b of fresh) seen.add(key(b.change))
      return true
    },
    // Go offline, or come back and publish what was held, in order.
    async go(on) {
      online = on
      if (!on) return
      await queue
      let out = held
      held = []
      if (out.length) await publish(out)
    },
  }
}
