// Routing comments to project heirs reads each commented-on target once.
import { equal, ok, test } from '@yaks/testing'
import type { Bundle, Graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { heirs } from './listen.ts'
let vocab = loadVocab([{
  $defs: {
    persona: {
      component: true,
      type: 'object',
      properties: { home: { type: 'string' } },
    },
  },
}])
let calls: string[][] = []
let g = {
  vocab,
  get: (ids: string[]) => {
    calls.push(ids)
    return ids.filter((id) => id != 'missing').map((id) => ({
      entity: { eid: id },
      filed: { project: 'p' },
    }))
  },
  read: () => [],
} as unknown as Graph
let letters: Bundle[] = Array.from(
  { length: 1000 },
  (_, i) => ({
    entity: { eid: `c${i}` },
    comment: { target: i % 2 ? 'a' : 'b' },
  }),
)
letters.push({
  entity: { eid: 'missing-comment' },
  comment: { target: 'missing' },
})
let answer = await heirs(g, letters)
let unique = [...new Set(calls.flat())]
test('project heirs gather shared comment target filings in one read', () => {
  equal(answer, [])
  equal(unique, ['b', 'a', 'missing'])
  equal(calls.length, 1)
  ok(calls[0].length == 3)
})
