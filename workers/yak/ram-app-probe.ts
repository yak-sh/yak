// App declaration transitions over independent RAM rows. A trial gets a copy
// of the serving rows, so rolling it back leaves the serving graph untouched.
import { type Graph, graph } from '@yaks/graph'
import { aliases } from '@yaks/alias'
import { keys } from '@yaks/key'
import { personal } from '@yaks/member'
import { THROUGH } from './config.ts'
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
      let saved = held.read('.entity&*', { graves: true })
      rows.tx((tx) => tx.patch(saved))
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
