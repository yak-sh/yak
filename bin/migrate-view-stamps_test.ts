import { equal as assertEquals, test } from '@yaks/testing'
import {
  type Candidate,
  decide,
  type Event,
  matches,
  openedOnly,
  type Stamp,
} from './migrate-view-stamps-plan.ts'
let stamp = (
  at: string,
  by: string | null = 'person',
  via: string | null = 'browser',
): Stamp => ({ at, by, via })
let edit: Event = {
  tx: 1,
  at: '2026-10-01T00:00:00.020Z',
  by: 'agent',
  via: 'session',
  changes: [{ component: 'doc', operation: 'upsert' }],
}
let view: Event = {
  tx: 2,
  at: '2026-10-04T00:00:00.020Z',
  by: 'person',
  via: 'browser',
  changes: [{ component: 'opened', operation: 'upsert' }, {
    component: 'opened',
    operation: 'upsert',
  }],
}
let candidate = (): Candidate => ({
  eid: 'task',
  created: stamp('2026-09-01T00:00:00.000Z'),
  updated: stamp('2026-10-04T00:00:00.000Z'),
  opened: stamp('2026-10-04T00:00:00.000Z'),
  events: [edit, view],
})
test('recover last substantive writer/time after repeated opened-only no-op writes', () => {
  let c = candidate()
  c.events.push({ ...view, tx: 3 })
  let d = decide(c)
  assertEquals(d.status, 'repair')
  assertEquals(d.sourceTx, 1)
  assertEquals(d.after, stamp(edit.at, 'agent', 'session'))
})
test('an actual edit in same entity transaction prevents repair', () => {
  let c = candidate()
  c.events[1] = {
    ...view,
    changes: [...view.changes, { component: 'doc', operation: 'upsert' }],
  }
  assertEquals(decide(c).status, 'preserve')
})
test('later substantive edit is never rolled back', () => {
  let c = candidate()
  c.events.push({ ...edit, tx: 3 })
  assertEquals(decide(c).status, 'preserve')
})
test('later unjournaled updated or different by/via is ambiguous', () => {
  for (
    let updated of [
      stamp('2026-10-05T00:00:00.000Z'),
      stamp('2026-10-04T00:00:00.000Z', 'other'),
      stamp('2026-10-04T00:00:00.000Z', 'person', null),
    ]
  ) {
    assertEquals(decide({ ...candidate(), updated }).status, 'ambiguous')
  }
})
test('missing pre-journal evidence is never invented', () => {
  assertEquals(decide({ ...candidate(), events: [] }).status, 'ambiguous')
  assertEquals(decide({ ...candidate(), events: [view] }).status, 'ambiguous')
})
test('opened removal alone is not a navigation upsert', () => {
  assertEquals(
    openedOnly({
      ...view,
      changes: [{ component: 'opened', operation: 'remove' }],
    }),
    false,
  )
})
test('provenance classifier rejects invalid, future and far-away stamp times', () => {
  for (
    let at of [
      'invalid',
      '2026-10-05T00:00:00.000Z',
      '2026-10-03T00:00:00.000Z',
    ]
  ) assertEquals(matches(stamp(at), view), false)
})
test('removal and re-add opened within same transaction remains opened-only', () => {
  assertEquals(
    openedOnly({
      ...view,
      changes: [{ component: 'opened', operation: 'remove' }, ...view.changes],
    }),
    true,
  )
})
test('prior entity deletion is ambiguous, not resurrected provenance', () => {
  let c = candidate()
  c.events[0] = {
    ...edit,
    changes: [{ component: 'entity', operation: 'delete' }],
  }
  assertEquals(decide(c).status, 'ambiguous')
})
