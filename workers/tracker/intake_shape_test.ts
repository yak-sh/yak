import { equal, test } from '@yaks/testing'
import { storage } from '@yaks/sqlite'
import { capture } from '@yaks/tracker/report'
import { mem } from '../../packages/sqlite/testing.ts'
import { options, store, vocab } from './core.ts'

let reports: Error[] = []
let saved = storage(mem(), vocab, {
  ...options,
  report: (e) => void reports.push(e),
})
saved.install()
let tracker = store(saved, { sink: () => {} })

test('fresh tracker intake reads pending subjects without corruption repairs', async () => {
  await tracker.ingest(capture(Error('intake fixture'), { sink: () => {} }))
  await tracker.drain()
  equal((await tracker.graph.read('.error')).length, 1)
  equal(reports, [])
  equal(await tracker.graph.rows('!entity.archetype .count'), [{
    value: '',
    n: 0,
  }])
})
