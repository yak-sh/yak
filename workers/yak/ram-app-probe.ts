// App declaration transitions over independent RAM rows. A trial gets a copy
// of the serving rows, so rolling it back leaves the serving graph untouched.
import { type Graph, graph } from '@yaks/graph'
import { dead } from '@yaks/graph/bundle'
import { aliases } from '@yaks/alias'
import { keys } from '@yaks/key'
import { personal } from '@yaks/member'
import { THROUGH } from '@yaks/platform/config'
import { ram, type Store } from '@yaks/ram'
import type { Vocab } from '@yaks/vocab'

export let ramApp = () => {
  let stores = new WeakMap<Graph, Store>()
  let make = (
    vocab: Vocab,
    previous?: Graph,
    _prepare?: unknown,
    reset = false,
  ) => {
    let rows = ram(vocab)
    let held = !reset && previous && stores.get(previous)
    if (held) {
      // A grave is read as a tombstone and laid again as one: patched, it
      // would come back a bare identity, which is nobody's row.
      let saved = held.read('.entity&*', { graves: true })
      rows.tx((tx) => {
        tx.patch(saved.map((b) => dead(b) ? { entity: b.entity } : b))
        tx.remove(saved.filter(dead).map((b) => b.entity))
      })
    }
    let g = graph({
      vocab,
      storage: rows,
      plugins: [
        keys(vocab),
        aliases(),
        personal(vocab, {}, THROUGH),
      ],
    })
    stores.set(g, rows)
    return g
  }
  let atomic = <T>(g: Graph, run: () => T): T => stores.get(g)!.tx(() => run())
  return { graph: make, atomic }
}
