// Which sessions the host places in a checkout of their own: a native fixer,
// and a native session holding a task. One holding nothing, and one an
// outside CLI runs, are not the host's to place.
import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { docDoc } from '@yaks/doc'
import { taskDoc } from '@yaks/task/vocab'
import { docs as sessionDocs } from '@yaks/session/vocab'
import { working } from './machines.ts'

// @yaks/heal's mark on a session fixing a bug, declared here so the CLI's
// tests load no package the CLI does not.
let fixer = {
  $defs: {
    fixer: {
      component: true,
      type: 'object',
      properties: { bug: { type: 'string' } },
    },
  },
}
let vocab = loadVocab([kernelDoc, docDoc, taskDoc, ...sessionDocs, fixer])
let g = graph({ storage: ram(vocab), vocab })
let session = (eid: string, more = {}) => ({
  entity: { eid },
  session: {},
  ...more,
})
await g.apply([
  session('fixing', { native: {}, fixer: { bug: 'bug' } }),
  session('started', { native: {} }),
  session('chatting', { native: {} }),
  session('spawned'),
  { entity: { eid: 'job' }, task: {}, claim: { session: 'started' } },
  { entity: { eid: 'other' }, task: {}, claim: { session: 'spawned' } },
], { trusted: true })

let placed = await Promise.all(
  ['fixing', 'started', 'chatting', 'spawned', 'nobody'].map((s) =>
    working(g, s)
  ),
)

test('a native fixer and a native session holding a task get a checkout; others are not placed', () => {
  equal(placed, ['fixer', 'task', undefined, undefined, undefined])
})
