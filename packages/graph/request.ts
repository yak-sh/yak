// The `$` keys a batch may carry. A bundle's ordinary keys name components,
// and admission refuses one this graph does not declare. A `$` key is another
// kind of thing: it asks the pipeline to DO something, and a request nobody
// implements did not happen — `$num: true` on a graph with no allocator would
// return a bundle with no number and no word about why. So an unknown request
// is refused too, and a plugin says which ones it answers (`Plugin.requests`).
//
// `$alias` and `$quiet` are the core's own bookkeeping rather than a caller's
// ask, and they are admitted for the same reason a stamped property is: a
// caller that read a bundle back and sent it again is doing a normal thing.
//
// `$touch` asks for a write even where the bundle holds what is stored: a
// write of what the graph already holds is otherwise no write
// (./unchanged.ts), and a graph whose copy is not the truth cannot tell.

export { requested, REQUESTS } from './bundle.ts'

import { after, each } from '@yaks/fp'
import type { Bundle } from './bundle.ts'
import type { Graph } from './graph.ts'
import type { Tx } from './storage.ts'
import { unchanged } from './unchanged.ts'

let unwritten = () => {
  throw new Error('a foresight reads, and writes nothing')
}

/**
 * What the plugins answering a batch's requests decide it writes, as
 * committed state stands, read outside any transaction: their `authorize`
 * hooks run over `outside`, as `apply()` runs them over its own transaction,
 * and a hook that writes there throws. It is a foresight, for a caller
 * choosing how to write: the write decides again inside its transaction, and
 * may find otherwise. Bundles no plugin decides come back as they went, and
 * what holds only what is stored leaves, as it leaves the write
 * (./unchanged.ts): a hook may say a row as it stands, which is no write.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { foreseen, graph } from '@yaks/graph'
 * import { hook } from '@yaks/graph/plugin'
 * import { ram } from '@yaks/ram'
 * import { loadVocab } from '@yaks/vocab'
 * let body = { type: 'string' }
 * let vocab = loadVocab([{ $defs: { note: { component: true, properties: { body } } } }])
 * let g = graph({ storage: ram(vocab), vocab })
 * // `$first` writes a note where the entity holds none yet.
 * g.use({
 *   name: 'first',
 *   requests: ['$first'],
 *   authorize: hook(['$first'], async ([b], tx) => {
 *     let [held] = await tx.get([b.entity.eid])
 *     return held?.note ? [] : [{ entity: b.entity, note: { body: 'first' } }]
 *   }),
 * })
 * let first = [{ entity: { eid: 'a' }, $first: {} }]
 * equal(await foreseen(g, first), [{ entity: { eid: 'a' }, note: { body: 'first' } }])
 * await g.apply([{ entity: { eid: 'a' }, note: { body: 'mine' } }])
 * equal(await foreseen(g, first), [])
 * // `$said` says the note as it stands, which writes nothing.
 * g.use({
 *   name: 'said',
 *   requests: ['$said'],
 *   authorize: hook(['$said'], async ([b], tx) => {
 *     let [held] = await tx.get([b.entity.eid])
 *     return [{ entity: b.entity, note: held!.note }]
 *   }),
 * })
 * equal(await foreseen(g, [{ entity: { eid: 'a' }, $said: {} }]), [])
 * ```
 */
export let foreseen = (
  g: Pick<Graph, 'plugins' | 'outside'>,
  bundles: Bundle[],
  trusted?: boolean,
): Bundle[] | Promise<Bundle[]> => {
  let tx: Tx = {
    ...g.outside,
    patch: unwritten,
    remove: unwritten,
    revive: unwritten,
  }
  let decided = each(g.plugins, bundles, (b, p) => {
    let h = p.authorize
    let asked = p.requests?.some((r) => b.some((x) => r in x))
    return h && asked && (!h.keys || b.some((x) => h.keys!.some((k) => k in x)))
      ? h(b, tx, undefined, { graph: g, trusted })
      : b
  })
  return after(decided, (b) => after(unchanged(b, tx), ({ kept }) => kept))
}
