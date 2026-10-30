import { equal, test } from '@yaks/testing'
import { corpus } from './window_bench.ts'
import { harness } from './testing.ts'
import { transcriptWindow } from '@yaks/session'

let h = await harness()
await h.g.apply(corpus(3, 10))
let page = await transcriptWindow(h.g, 'session', { limit: 2 })
let effects = await h.g.read('.effect&*')
await h.close()

test('stored transcript benchmark reads history without owing model turns', () => {
  equal(page.entries.length, 2)
  equal(page.total, 3)
  equal(effects, [])
})
