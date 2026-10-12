// Numeric lists exercise the same indexed read as an entering world tile,
// with every row counted by workerd's cursor rather than its query plan.
import { driver, type DurableStorage } from '@yaks/durable-object'
import { graph } from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import { loadVocab } from '@yaks/vocab'

export let numericSelectorCost = async (db: DurableStorage) => {
  let counting = false, read = 0, written = 0
  let sql = driver(db, (s) => {
    if (!counting) return
    read += s.rowsRead
    written += s.rowsWritten
  })
  let vocab = loadVocab({
    $defs: {
      point: {
        component: true,
        properties: { x: { type: 'number', index: true } },
      },
    },
  })
  let store = storage(sql, vocab)
  store.install()
  let g = graph({ vocab, storage: store })
  g.apply([1, 2, 2.5, 3, 1000, 1000.5, 1001].map((x, i) => ({
    entity: { eid: `point-${i}` },
    point: { x },
  })))
  g.apply(Array.from({ length: 1000 }, (_, i) => ({
    entity: { eid: `fraction-${i}` },
    point: { x: 1000 + (i + 1) / 1024 },
  })))
  let measure = async (xs: number[]) => {
    read = written = 0
    counting = true
    let rows = await g.read(`.point.x=${xs}&.fields=point.x`)
    counting = false
    return { rows, read, written }
  }
  let runs = (starts: number[]) =>
    starts.flatMap((x) => [x, x + 1, x + 2, x + 3])
  return {
    empty: await measure(runs([10, 100, 10000, 100000])),
    occupied: await measure(runs([10, 100, 1000, 10000])),
  }
}
