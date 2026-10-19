// A future builder floor is clock readiness, independent of worker restarts.

import { equal, test } from '@yaks/testing'
import { tick } from '@yaks/wake'
import { toolEid } from '@yaks/tools'
import { code } from './code.ts'
import { ids, shop } from './testing.ts'

let now = '2026-09-19T12:00:00.000Z'
let floor = '2026-09-19T12:01:00.000Z'
let calls = 0
let tool = code({
  name: 'floor',
  description: 'Answer a scheduled binding',
  answer: ({ binding }) => {
    calls++
    return {
      outputs: [{
        slot: 'main',
        inputs: binding.entities.map(String),
        components: { doc: { body: 'Ready' } },
      }],
    }
  },
})
let { g, fx, failed } = await shop({ now: () => now, tools: [tool] }, [], [
  tool,
])
await g.apply([{
  entity: { eid: ids.source },
  doc: { title: 'Clock source' },
}, {
  entity: { eid: ids.builder },
  builder: { query: '.doc.title="Clock source"', to: toolEid('floor'), floor },
}])
await fx.idle()
let early = calls
let wakes = await g.read(`.wake.target=${ids.builder}`)
now = floor
let rang = await tick(g, Date.parse(now))
await fx.idle()
let outputs = await g.read('.doc.body=Ready')
test('a builder at a future floor becomes ready through its recorded wake', () => {
  equal(early, 0)
  equal(wakes.map((b) => b.wake), [{ at: floor, target: ids.builder }])
  equal(rang.refused, [])
  equal(calls, 1)
  equal(outputs.length, 1)
  equal(failed, [])
})
