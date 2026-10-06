/** Source quota tests exercise loops, distinct code and independent retention
 * reasons without reading a clock or writing Store state. */
import { equal, test } from '@yaks/testing'
import { project, type RequestState, selectRequest } from './mod.ts'

let threshold = {
  op: 'request',
  name: 'http query',
  now: 100,
  rowsRead: 10_001,
  rowsWritten: 0,
}

test('a loop keeps one automatic trace per rolling hour and carries every repeat', () => {
  let state: RequestState = new Map()
  let first = selectRequest(threshold, state)
  equal(first.reason, 'automatic')
  equal(first.repeats, 0)
  equal(state.size, 0)
  state = first.state
  for (let i = 0; i < 50; i++) {
    let decision = selectRequest({ ...threshold, now: 200 + i }, state)
    equal(decision.reason, undefined)
    state = decision.state
  }
  let near = selectRequest(
    { ...threshold, now: threshold.now + 3_600_000 - 1 },
    state,
  )
  equal(near.reason, undefined)
  let next = selectRequest(
    { ...threshold, now: threshold.now + 3_600_000 },
    near.state,
  )
  equal(next.reason, 'automatic')
  equal(next.repeats, 51)
  let again = selectRequest(
    { ...threshold, now: threshold.now + 3_600_001 },
    next.state,
  )
  equal(again.reason, undefined)
  equal(next.state.get(JSON.stringify(['request', 'http query']))?.repeats, 0)
})

test('operation and name partition the rolling quota; a backwards clock cannot release it', () => {
  let first = selectRequest(threshold)
  equal(selectRequest({ ...threshold, now: 99 }, first.state).reason, undefined)
  equal(
    selectRequest({ ...threshold, name: 'http apply' }, first.state).reason,
    'automatic',
  )
  equal(
    selectRequest({ ...threshold, op: 'query' }, first.state).reason,
    'automatic',
  )
  // Coordinates are tuples, not a delimiter that aliases arbitrary code names.
  let collision = selectRequest({ ...threshold, op: 'a:b', name: 'c' })
  equal(
    selectRequest({ ...threshold, op: 'a', name: 'b:c' }, collision.state)
      .reason,
    'automatic',
  )
})

test('on-demand and sampled captures carry pending repeats but do not reset automatic timing', () => {
  let first = selectRequest(threshold)
  let suppressed = selectRequest({ ...threshold, now: 200 }, first.state)
  let requested = selectRequest(
    { ...threshold, now: 300, requested: true },
    suppressed.state,
  )
  equal(requested.reason, 'requested')
  equal(requested.repeats, 1)
  equal(requested.state.get(JSON.stringify(['request', 'http query']))?.at, 100)
  let suppressedAgain = selectRequest(
    { ...threshold, now: 400 },
    requested.state,
  )
  equal(suppressedAgain.reason, undefined)
  let ordinarySample = selectRequest({
    ...threshold,
    now: 500,
    rowsRead: 0,
    rate: 1,
  }, suppressedAgain.state)
  equal(ordinarySample.reason, 'sampled')
  equal(ordinarySample.repeats, 1)
  equal(
    selectRequest({ ...threshold, now: 600 }, ordinarySample.state).reason,
    undefined,
  )
  equal(
    selectRequest({ ...threshold, now: 3_600_100 }, ordinarySample.state)
      .reason,
    'automatic',
  )
  let overLineSample = selectRequest({
    ...threshold,
    now: 650,
    rate: 0.1,
    random: 0.09,
  }, ordinarySample.state)
  equal(overLineSample.reason, 'sampled')
  equal(overLineSample.state, ordinarySample.state)
})

test('repeat count projects to a separate metric only on the root span', () => {
  let rows = project([{
    id: 'root',
    kind: 'request',
    name: 'http query',
    stage: 'end',
    time: 0,
    duration: 0,
  }, {
    id: 'child',
    parent: 'root',
    kind: 'query',
    name: 'read',
    stage: 'end',
    time: 0,
    duration: 0,
  }], { origin: 0, eid: crypto.randomUUID(), repeats: 23 })
  equal(rows[0].repeats, undefined)
  equal(rows[1].repeats, { n: 23 })
  equal(rows[2].repeats, undefined)
})
