// The duty measures the file once a day: the day's row holds what the store
// measured, a second look that day measures nothing, and a store with no
// file of pages is left alone.
import { equal, test } from '@yaks/testing'
import { graph, type Measure } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { journalDoc } from './vocab.ts'
import { keptEid, pass } from './service.ts'

let vocab = loadVocab([journalDoc])
let NOON = Date.parse('2026-10-21T12:00:00Z')
let file: Measure = { bytes: 300, free: 0, tables: { journal_change: [50, 4] } }

test('a day is measured once, into its row', async () => {
  let asked = 0
  let storage = {
    ...ram(vocab),
    measure: () => (asked++, Promise.resolve(file)),
  }
  let g = graph({ vocab, storage })
  await pass(g, NOON)
  await pass(g, NOON + 3600_000)
  let [row] = await g.get([keptEid('2026-10-21')], ['kept'])
  equal(asked, 1)
  equal({ ...row.kept as object, at: '' }, {
    day: '2026-10-21',
    at: '',
    ...file,
  })
})

test('a store with no file of pages is not measured', async () => {
  let g = graph({ vocab, storage: ram(vocab) })
  await pass(g, NOON)
  equal(await g.get([keptEid('2026-10-21')], ['kept']), [])
})
