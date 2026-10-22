// The duty measures the file once a day: the day's row holds what the store
// measured and the changes its journal held, a second look that day measures
// nothing, and a store with no
// file of pages is left alone. The row naming the file is `measured`'s.
import { equal, test } from '@yaks/testing'
import { type Graph, graph, type Measure } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { journalDoc } from './vocab.ts'
import { keptEid, pass } from './service.ts'

let vocab = loadVocab([journalDoc])
let NOON = Date.parse('2026-10-21T12:00:00Z')
let file: Measure = { bytes: 300, free: 0, tables: { journal_change: [50, 4] } }

// A graph over a file measured as `file`, and how often it was measured.
let measuring = () => {
  let asked = { n: 0 }
  let storage = {
    ...ram(vocab),
    measure: () => (asked.n++, Promise.resolve(file)),
  }
  return { g: graph({ vocab, storage }), asked }
}

let kept = async (g: Graph): Promise<Record<string, unknown>> => {
  let [row] = await g.get([keptEid('2026-10-21')], ['kept'])
  return { ...row?.kept as object, at: '' }
}

test('a day is measured once, into its row, with the changes held', async () => {
  let { g, asked } = measuring()
  let held = () => ({ doc: 3, entity: 1 })
  await pass(g, NOON, undefined, held)
  await pass(g, NOON + 3600_000, undefined, held)
  equal(asked.n, 1)
  equal(await kept(g), {
    day: '2026-10-21',
    at: '',
    ...file,
    changes: { doc: 3, entity: 1 },
  })
})

test('a day measured before its changes were counted is measured again', async () => {
  let { g, asked } = measuring()
  await pass(g, NOON)
  await pass(g, NOON + 3600_000, undefined, () => ({ doc: 3 }))
  equal(asked.n, 2)
  equal((await kept(g)).changes, { doc: 3 })
})

test('a store with no file of pages is not measured', async () => {
  let g = graph({ vocab, storage: ram(vocab) })
  await pass(g, NOON)
  equal(await g.get([keptEid('2026-10-21')], ['kept']), [])
})
