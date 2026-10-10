// A file-backed reader, with vocabulary and ID resolution but no writers,
// processes, graph hooks or services. A preflight that only needs stored rows
// never composes the imperative host around a graph.
import type { Graph } from '@yaks/graph'
import { reader as graph } from '@yaks/graph/read'
import { ids } from '@yaks/id/graph'
import { reader as storage } from '@yaks/sqlite/reader'
import { open } from '@yaks/sqlite/read-db'
import { loadVocab } from '@yaks/vocab'
import { type Config, dbOf, subpath } from './config.ts'
import { understood } from './keywords.ts'
import type { VocabFacet } from './host.ts'

export type Reader = {
  graph: Pick<Graph, 'read' | 'get' | 'address'>
  close: () => void
}

/** Read the stored components declared by `plugins` in an installed graph.
 * The caller chooses its vocabulary; no plugin's executable graph facet runs.
 * The reader cannot apply a write and the file itself is opened read-only. */
export let reader = async (
  config: Config,
  plugins: string[],
): Promise<Reader> => {
  let facets = await Promise.all(
    plugins.map((p) => subpath<VocabFacet>(p, 'vocab')),
  )
  let vocab = loadVocab(
    facets.flatMap((f) => f?.docs ?? []),
    understood(facets.flatMap((f) => f?.keywords ?? [])),
  )
  let sql = open(dbOf(config))
  try {
    let store = storage(sql, vocab, {
      derived: Object.assign({}, ...facets.map((f) => f?.derived?.(vocab))),
      backed: Object.assign({}, ...facets.map((f) => f?.backed?.(vocab))),
    })
    let g = graph({ storage: store, vocab, plugins: [ids(vocab)] })
    return {
      graph: { read: g.read, get: g.get, address: g.address },
      close: () => sql.close(),
    }
  } catch (e) {
    sql.close()
    throw e
  }
}
