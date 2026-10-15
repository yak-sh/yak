// Tracker tests use graph admission and queries, with no filesystem or Worker.
// External references use UUIDs or commit hashes: absent word names are refused
// even in trusted writes, while global eids need no local catalog record.
import {
  type Bundle,
  detached,
  type Graph,
  graph,
  type Storage,
} from '@yaks/graph'
import { comps } from '@yaks/graph/bundle'
import { Refused } from '@yaks/graph/errors'
import { guard } from '@yaks/graph/guard'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { toolsDoc } from '@yaks/tools/vocab'
import { apiDoc } from '@yaks/api/vocab'
import { docDoc } from '@yaks/doc'
import { mailDoc } from '@yaks/mail/vocab'
import { wakeDoc } from '@yaks/wake'
import { ram } from '@yaks/ram'
import { computed, trackerDoc } from './vocab.ts'
import { effects as registry } from '@yaks/effects'
import { effects, type Options } from './effects.ts'

export let vocab = loadVocab([
  kernelDoc,
  toolsDoc,
  apiDoc,
  docDoc,
  mailDoc,
  trackerDoc,
  wakeDoc,
], [kernelKeywords])

export let fixture = (
  options?: Options,
  clock = () => '2026-10-02T00:00:10Z',
  adapt = (g: Graph): Graph => g,
  storage: Storage = ram(vocab, { computed }),
) => {
  let g: ReturnType<typeof graph>
  let fx = options
    ? registry(vocab, { write: (b) => g.apply(b, { trusted: true }) })
    : undefined
  g = graph({
    vocab,
    storage,
    actor: { by: crypto.randomUUID(), via: crypto.randomUUID() },
    clock,
    plugins: fx ? [fx] : [],
  })
  if (fx) fx.handle(effects({ graph: adapt(g) }, options))
  return g
}

/** The graph as a trusted handler reads and writes it, without the pipeline
 * around its store: a write is refused for a component or value the
 * vocabulary cannot hold and lands once each `$was` it carries holds, as
 * `apply()` checks them, and is not stamped. For cases that exercise a
 * handler's own reads and writes; {@link fixture} is the graph whole. */
export let bare = (
  storage: Storage = ram(vocab, { computed }),
): Pick<Graph, 'vocab' | 'get' | 'read' | 'apply'> => {
  let tx = detached(storage)
  return {
    vocab,
    get: tx.get,
    read: tx.read,
    apply: async (rows: Bundle[]) => {
      let wrong = rows.flatMap((b) =>
        comps(b).flatMap(([name, c]) =>
          c ? vocab.check(name, c, { stamped: true }) : []
        )
      )
      if (wrong.length) throw new Refused(wrong.join('; '))
      await guard(rows, tx, vocab)
      await tx.patch(rows)
      return tx.get(rows.map((b) => b.entity.eid))
    },
  }
}
