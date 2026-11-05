// A space a budget hold gave empty plan, comped, budget or starter components
// loses those, and keeps every one that holds something.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { holdEmptyRule } from './hold-move.ts'

let comp = (...props: string[]) => ({
  component: true,
  type: 'object',
  properties: Object.fromEntries(props.map((p) => [p, { type: 'string' }])),
})
let vocab = loadVocab([kernelDoc, {
  $defs: {
    space: comp(),
    plan: comp(
      'tier',
      'customer',
      'subscription',
      'status',
      'until',
      'ending',
      'at',
    ),
    comped: comp('until'),
    budget: { ...comp(), properties: { dollars: { type: 'number' } } },
    starter: { ...comp(), properties: { dollars: { type: 'number' } } },
  },
}])
let g = graph({ vocab, storage: ram(vocab) })
await g.apply([
  {
    entity: { eid: 'held' },
    space: {},
    plan: {},
    comped: {},
    budget: {},
    starter: {},
  },
  { entity: { eid: 'paid' }, space: {}, plan: { tier: 'plus' }, starter: {} },
  { entity: { eid: 'clean' }, space: {}, budget: { dollars: 5 } },
], { trusted: true, stamp: false })

test('a space loses the empty components a hold gave it, and keeps the rest', async () => {
  let rows = await g.read(holdEmptyRule.find)
  let moved = Object.fromEntries(
    rows.map((row) => [row.entity.eid, holdEmptyRule.move(row)]),
  )
  assertEquals(moved, {
    held: [{
      entity: { eid: 'held' },
      plan: null,
      comped: null,
      budget: null,
      starter: null,
    }],
    paid: [{ entity: { eid: 'paid' }, starter: null }],
  })
})
