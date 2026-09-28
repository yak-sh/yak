// The cost of reading one transcript's computed status while another holds a
// large history of calls. Both doors are used by a Store reading call rows.
import { type Bundle, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { mem } from '../sqlite/testing.ts'
import { toolsDoc } from '@yaks/tools/vocab'
import { sessionDoc } from './comp.ts'
import { sessionDerived } from './status.ts'

let vocab = loadVocab([sessionDoc, toolsDoc])
let store = storage(mem(), vocab, { derived: sessionDerived })
store.install()
let g = graph({ storage: store, vocab })
store.tx((tx) =>
  tx.patch([
    { entity: { eid: 'target' }, session: { id: 'target' } },
    { entity: { eid: 'other' }, session: { id: 'other' } },
  ])
)
for (let from = 0; from < 48_000; from += 1000) {
  let rows: Bundle[] = []
  for (let i = from; i < Math.min(from + 1000, 48_000); i++) {
    rows.push({
      entity: { eid: `e${i}` },
      entry: { session: i == 0 ? 'target' : 'other', seq: i },
      ...(i > 0 && i <= 2700
        ? { call: {}, execution: { state: 'done' } }
        : { content: { body: 'line' } }),
    })
  }
  store.tx((tx) => tx.patch(rows))
}

Deno.bench('status by identity beside 2,700 other calls', () => {
  g.get(['target'])
})

Deno.bench('status by query beside 2,700 other calls', () => {
  g.read('.eid=target&*')
})
