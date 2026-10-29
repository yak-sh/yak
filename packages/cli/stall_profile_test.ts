import { equal, ok, test } from '@yaks/testing'
import { type Profiler } from 'node:inspector'
import { sampler, stacks } from './stall_profile.ts'

let node = (id: number, name: string, children: number[] = []) => ({
  id,
  callFrame: {
    functionName: name,
    scriptId: '1',
    url: 'file:///web.ts',
    lineNumber: 9,
    columnNumber: 2,
  },
  hitCount: 0,
  children,
})
let profile: Profiler.Profile = {
  nodes: [
    node(1, '(root)', [2, 4]),
    node(2, 'serialize', [3]),
    node(3, 'stringify'),
    node(4, '(idle)'),
  ],
  startTime: 0,
  endTime: 1_000_000,
  samples: [2, 2, 2, 4, 3],
  timeDeltas: [100_000, 100_000, 100_000, 100_000, 500_000],
}

test('a held profile names the running leaf and caller, excluding earlier work', () => {
  let said = stacks(profile, 500)
  ok(said.includes('1 samples:'))
  ok(said.includes('at stringify (file:///web.ts:10:3)'))
  ok(said.includes('at serialize (file:///web.ts:10:3)'))
  ok(!said.includes('at (idle)'))
  equal(
    stacks({ ...profile, samples: [] }, 500),
    'no running stacks were sampled during the gap',
  )
})

test('sampled stack output is bounded even for deep and diverse work', () => {
  let nodes = Array.from(
    { length: 100 },
    (_, i) => node(i + 1, `frame${i}`, [i + 2]),
  )
  let said = stacks({
    nodes,
    startTime: 0,
    endTime: 100,
    samples: nodes.map((n) => n.id),
    timeDeltas: nodes.map(() => 1),
  }, 1)
  equal(said.split('\n').filter((line) => line.endsWith('samples:')).length, 3)
  ok(said.split('\n').length <= 3 * 25)
})

test('a hold during profile rotation keeps its evidence and closes its sampler', async () => {
  let at = 0, connected = false
  let stopped: ((error: Error | null, value?: unknown) => void) | undefined
  let s = await sampler({
    now: () => at,
    session: {
      connect: () => {
        connected = true
      },
      disconnect: () => {
        connected = false
      },
      post: (method, _params, done) => {
        if (method == 'Profiler.stop') stopped = done
        else done(null)
      },
    },
  })
  at = 60_000
  let rotation = s.take(1000, false)
  let held = s.take(500, true)
  let closing = s.close()
  ok(connected)
  ok(stopped)(null, { profile })
  await rotation
  ok((await held)?.includes('at stringify'))
  // close waits for the outstanding rotation, then stops its replacement.
  await Promise.resolve()
  ok(stopped)(null, { profile })
  await closing
  ok(!connected)
})
