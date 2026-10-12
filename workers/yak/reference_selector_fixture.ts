// A finite reference list must read its targets, not a billed JSON virtual
// table beside them. This uses the storage query interface and real cursors.
import { driver, type DurableStorage } from '@yaks/durable-object'
import { graph } from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import { loadVocab } from '@yaks/vocab'

export let referenceSelectorCost = (db: DurableStorage) => {
  let counting = false, read = 0, written = 0
  let shapes: { sql: string; read: number }[] = []
  let sql = driver(db, (s) => {
    if (!counting) return
    shapes.push({ sql: s.shape, read: s.rowsRead })
    read += s.rowsRead
    written += s.rowsWritten
  })
  let vocab = loadVocab({
    $defs: {
      player: { component: true },
      look: {
        component: true,
        properties: { player: { type: 'string', ref: 'entity', index: true } },
      },
    },
  })
  let store = storage(sql, vocab)
  store.install()
  let g = graph({ vocab, storage: store })
  let targets = Array.from({ length: 9 }, (_, i) => `player-${i}`)
  g.apply([
    ...targets.map((eid) => ({ entity: { eid }, player: {} })),
    { entity: { eid: 'look' }, look: { player: targets[0] } },
  ])
  sql.query({ t: 'analyze' })
  store.rows('.look .count')
  counting = true
  let rows = store.rows(`.look.player=${targets}`)
  counting = false
  return { rows, read, written, shapes }
}
