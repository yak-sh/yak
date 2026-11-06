// A provider's catalog gives the graph's model rows their windows.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { graph, identityEid } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { modelDoc } from '@yaks/model'
import { windows } from './runs.ts'

// Two model rows, one with a window of its own.
let models = loadVocab([modelDoc])
let row = (name: string, context?: number) => ({
  entity: { eid: identityEid('model', [name]) },
  model: { name, ...context ? { context } : {} },
})
let rows = graph({ storage: ram(models), vocab: models })
await rows.apply([row('gpt-6.1-sol', 1_000_000), row('gpt-6-astra')])

test('a catalog gives a model row its window, unless the row has its own', async () => {
  let listed = await windows(rows, [
    { name: 'gpt-6.1-sol', context: 272_000 },
    { name: 'gpt-6-astra', context: 272_000 },
    { name: 'unseen', context: 64_000 },
  ])
  assertEquals(listed.map((m) => m.context), [1_000_000, 272_000, 64_000])
  let kept = await rows.get(listed.map((m) => identityEid('model', [m.name])))
  assertEquals(kept.map((b) => (b.model as { context?: number }).context), [
    1_000_000,
    272_000,
  ])
})
