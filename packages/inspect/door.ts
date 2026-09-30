/**
 * The door every inspector view is drawn through. `inspector(registry, host)`
 * binds a registry of views ({@link View}) to what a host supplies, and gives
 * `Door`: `<Door e={bundle} view='Inspect.Full' />` selects the view for the
 * bundle (@yaks/render `resolve`), asks the host for what that view asks,
 * and draws its component with the bundle, the answers and `io`.
 *
 * `io.state` reads the inspector's own entities in the page's own graph, and a
 * render that reads one is woken when that graph changes; `io.set` writes
 * them. Everything else on `io` is the host's, passed through.
 *
 * @module
 */

import { type FunctionComponent, h } from 'preact'
import { signal } from '@preact/signals'
import { type Context, resolve, type Selection } from '@yaks/render'
import type { Bundle, Host, Io, View } from './host.ts'
import { docs } from './front.ts'

/** What `Door` takes: the bundle, the view it is drawn as, and the context
 * the view is drawn with. */
export type DoorProps = { e: Bundle; view: string; ctx?: Context }

/** A host's inspector: the door views are drawn through, and their `io`. */
export type Inspector = {
  Door: FunctionComponent<DoorProps>
  io: Io
}

// The components the inspector keeps in the page's own graph.
let mine = Object.keys(docs[0].$defs ?? {})

/** Bind a registry of views to a host. */
export let inspector = (
  registry: Selection<View>,
  host: Host,
): Inspector => {
  let { useAnswers, front, ...doors } = host
  // One watch per component of the inspector's own, each change a new turn:
  // a read of the page's graph during a render subscribes that render to it.
  let turn = signal(0)
  for (let comp of mine) {
    front.watch(`.${comp}`).subscribe(() => turn.value++)
  }
  let io: Io = {
    ...doors,
    show: (b, view, ctx) =>
      h(Door, { key: `${b.entity.eid} ${view}`, e: b, view, ctx }),
    can: (b, view) => !!resolve(registry, b, view, host.vocab),
    state: (eid) => (turn.value, front.ent(eid)),
    set: (change) => void front.mutate(change),
  }
  let Door: FunctionComponent<DoorProps> = ({ e, view, ctx = {} }) => {
    let r = resolve(registry, e, view, host.vocab)
    let got = useAnswers(r?.asks?.(e, io, ctx) ?? {})
    return r ? h(r.Render, { e, got, io, ctx }) : null
  }
  return { Door, io }
}
