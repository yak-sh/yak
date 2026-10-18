import { equal, test } from '@yaks/testing'
import type { Bundle, Graph } from '@yaks/graph'
import { earlierInput } from './instructions.ts'

let input: Bundle = {
  entity: { eid: 'new' },
  content: { body: 'attachment files' },
  created: { by: 'ada', at: '2026-02-01T00:00:00Z' },
}
let old: Bundle = {
  entity: { eid: 'old' },
  entry: { session: 's' },
  content: { body: 'keep attachment files immutable' },
  created: { by: 'ada', at: '2026-01-01T00:00:00Z' },
}
let g = {
  vocab: { comp: () => ({}) },
  get: () =>
    Promise.resolve([{ entity: { eid: 'ada' }, doc: { title: 'Ada' } }]),
  read: () => Promise.resolve([old]),
} as unknown as Graph

test('native turn context carries earlier words without changing the input', async () => {
  let items = await earlierInput(g, [input], 'ada')
  equal(items.length, 1)
  equal(items[0].text.includes('old · 2026-01-01'), true)
  equal(items[0].text.includes('keep attachment files immutable'), true)
  equal((input.content as { body: string }).body, 'attachment files')
})
test('an agent input does not borrow the configured person’s history', async () => {
  equal(
    await earlierInput(g, [{
      ...input,
      created: { by: 'agent', at: '2026-02-01T00:00:00Z' },
    }], 'ada'),
    [],
  )
})
