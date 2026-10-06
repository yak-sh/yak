/** Stored spans retain relationships and independent measurements without
 * copying arbitrary event fields or mutating a recorded tree. */
import { derivedEid } from '@yaks/graph'
import { equal, test } from '@yaks/testing'
import type { Event } from '@yaks/trace'
import { project, type TraceRow } from './mod.ts'

let origin = Date.parse('2026-01-01T00:00:00Z')
let eid = 'a3f19c02-4b00-4000-8000-000000000001'
let id = (event: string) => derivedEid(`span|${JSON.stringify([eid, event])}`)

test('projection creates separately measured spans with global parent references', () => {
  let spans: Event[] = [{
    id: '1.1',
    kind: 'request',
    name: 'http',
    stage: 'end',
    start: 1000,
    time: 1020,
    duration: 20,
    outcome: 'ok',
    counts: { rowsRead: 20, rowsWritten: 5, statements: 3, bundles: 2 },
  }, {
    id: '1.2',
    parent: '1.1',
    kind: 'phase',
    name: 'commit',
    stage: 'end',
    start: 1002,
    time: 1007,
    duration: 5,
    plugin: '@yaks/task',
    package: '@yaks/graph',
    outcome: 'ok',
    counts: { rowsWritten: 0 },
  }, {
    id: '1.3',
    parent: '1.2',
    kind: 'fanout',
    name: 'fanout',
    stage: 'instant',
    time: 1003,
  }, {
    id: '1.4',
    parent: '1.1',
    kind: 'effect',
    name: 'effect',
    stage: 'start',
    time: 1004,
  }]
  let before = structuredClone(spans)
  let during = { space: eid }
  let rows = project(spans, { origin, eid, during })
  equal(
    rows,
    [{
      entity: { eid },
      trace: { op: 'request', name: 'http', at: '2026-01-01T00:00:01.000Z' },
      during: { space: eid },
    }, {
      entity: { eid: id('1.1') },
      span: { trace: eid, op: 'request', name: 'http', outcome: 'ok' },
      elapsed: { start: 0, ms: 20 },
      rows_read: { n: 20 },
      rows_written: { n: 5 },
      statements: { n: 3 },
    }, {
      entity: { eid: id('1.2') },
      span: {
        trace: eid,
        parent: id('1.1'),
        op: 'phase',
        name: 'commit',
        plugin: '@yaks/task',
        package: '@yaks/graph',
        outcome: 'ok',
      },
      elapsed: { start: 2, ms: 5 },
      rows_written: { n: 0 },
    }, {
      entity: { eid: id('1.3') },
      span: { trace: eid, parent: id('1.2'), op: 'fanout', name: 'fanout' },
      elapsed: { start: 3, ms: 0 },
    }, {
      entity: { eid: id('1.4') },
      span: { trace: eid, parent: id('1.1'), op: 'effect', name: 'effect' },
      elapsed: { start: 4 },
    }].map((row) => ({ ...row, during: { space: eid } })) as TraceRow[],
  )
  equal(project(spans, { origin, eid, during }), rows)
  rows[1].rows_read!.n = 99
  rows[0].during!.space = 'changed'
  equal(spans, before)
  equal(during, { space: eid })
})

test('different traces have different span identities and external parents are omitted', () => {
  let spans: Event[] = [{
    id: '1.1',
    parent: 'outside',
    kind: 'sql',
    name: 'select',
    stage: 'instant',
    time: 0,
  }]
  let a = project(spans, { origin, eid })
  let b = project(spans, { origin, eid: id('other') })
  equal(a[1].span?.parent, undefined)
  equal(a[1].entity.eid == b[1].entity.eid, false)
  equal(project([], { origin, eid }), [])
})
