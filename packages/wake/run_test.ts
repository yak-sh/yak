// A firing's call runs once through the host's runner, with no model turn,
// and its occurrence keeps what it came to.

import { equal, test } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { runner, toolEid, toolsDoc } from '@yaks/tools'
import { wakeDoc } from './comp.ts'
import { occurrenceOf, run } from './run.ts'

let vocab = loadVocab([toolsDoc, wakeDoc])
let g = graph({ vocab, storage: ram(vocab) })
let ran = 0
let r = runner(g, {
  tools: [
    {
      name: 'count',
      description: 'Count once.',
      run: (call) => [{
        entity: { eid: '$said' },
        content: { body: `${++ran}` },
        output: { source: call.entity.eid },
      }],
    },
    {
      name: 'broken',
      description: 'Fail.',
      run: () => {
        throw new Error('weekly import broke')
      },
    },
  ],
})
await r.ensure()
let wake = (to: string): Bundle => ({
  entity: { eid: to },
  wake: { at: '2030-01-01T00:00:00.000Z', every: '1d' },
  call: { to: toolEid(to), args: {} },
})
await g.apply([wake('count'), wake('broken'), {
  entity: { eid: 'say' },
  wake: { every: '1d', note: 'look' },
}])
let at = '2030-01-01T00:00:00.000Z'
let host = { runner: () => r }
let first = await run(g, wake('count'), at, host)
let again = await run(g, wake('count'), at, host)
let failed = await run(g, wake('broken'), at, host)
let none = await run(g, { entity: { eid: 'say' } }, at, host)
let [kept] = await g.get([occurrenceOf('broken', at)])

test('a firing runs its call once, and a replay recalls its answer', () => {
  equal([ran, first?.text, again?.text, first?.error], [1, '1', '1', undefined])
  equal(first?.occurrence, occurrenceOf('count', at))
})

test('a call that fails says so, and its occurrence keeps the failure', () => {
  equal(failed?.error?.includes('weekly import broke'), true)
  equal(
    (kept.occurrence as { error: string }).error.includes('weekly import'),
    true,
  )
  equal(none?.text, 'Nothing was called.')
})
