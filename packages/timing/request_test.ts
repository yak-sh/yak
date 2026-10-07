/** Request selection compares actual cursor counts and explicit host triggers;
 * an unselected request has no bundles to deliver. */
import { equal, test, throws } from '@yaks/testing'
import type { Event } from '@yaks/trace'
import { derivedEid } from '@yaks/graph'
import { sampleRequest, selectedRequest } from './mod.ts'

let ordinary = { rowsRead: 10_000, rowsWritten: 10_000 }
let options = {
  origin: 0,
  eid: 'a3f19c02-4b00-4000-8000-000000000001',
  ...ordinary,
}
let root: Event = {
  id: '1.1',
  kind: 'request',
  name: 'http',
  stage: 'end',
  start: 1,
  time: 1,
  duration: 0,
}

test('request threshold is strictly over either independent row count', () => {
  equal(selectedRequest(ordinary), false)
  equal(selectedRequest({ ...ordinary, rowsRead: 10_001 }), true)
  equal(selectedRequest({ ...ordinary, rowsWritten: 10_001 }), true)
  equal(selectedRequest({ rowsRead: 6000, rowsWritten: 6000 }), false)
  equal(selectedRequest({ rowsRead: 0, rowsWritten: 0, requested: true }), true)
})

test('ordinary sampling compares a supplied draw to the configured probability', () => {
  equal(selectedRequest({ ...ordinary, rate: 0, random: 0 }), false)
  equal(selectedRequest({ ...ordinary, rate: 1 }), true)
  equal(selectedRequest({ ...ordinary, rate: 0.1, random: 0.099 }), true)
  equal(selectedRequest({ ...ordinary, rate: 0.1, random: 0.1 }), false)
  for (let rate of [-1, 2, NaN]) {
    throws(() => selectedRequest({ ...ordinary, rate }))
  }
  for (let random of [undefined, -1, 1, NaN]) {
    throws(() => selectedRequest({ ...ordinary, rate: 0.1, random }))
  }
})

test('request projection emits no bundles without a trigger or for an open root', () => {
  equal(sampleRequest([root], options), undefined)
  equal(sampleRequest([], { ...options, requested: true }), undefined)
  equal(
    sampleRequest([{ ...root, stage: 'start' }], {
      ...options,
      requested: true,
    }),
    undefined,
  )
  let saved = sampleRequest([root], { ...options, requested: true })!
  equal(saved.length, 2)
  equal(saved[0].trace, {
    op: 'request',
    name: 'http',
    at: '1970-01-01T00:00:00.001Z',
  })
  equal(saved[1].elapsed, { start: 0, ms: 0 })
})

test('a span lists the statements it ran, with those of the spans its trace left out', () => {
  let span = (
    id: string,
    parent: string,
    kind: Event['kind'],
    rowsRead = 0,
    sql?: string,
  ): Event => ({
    id,
    parent,
    kind,
    name: kind,
    stage: 'end',
    time: 1,
    duration: 1,
    counts: { rowsRead, rowsWritten: 0, statements: 1 },
    ...sql ? { sql } : {},
  })
  let a = 'select "title" from "book" where "id" = ?', b = 'begin', c = 'commit'
  // 303 statements: the cap keeps the root, the read and the 198 that read
  // the most, and leaves out the phase and the statement under it.
  let saved = sampleRequest([
    { ...root, counts: { rowsRead: 300, statements: 303 } },
    span('q', '1.1', 'query', 300),
    ...Array.from({ length: 150 }, (_, i) => span(`a${i}`, 'q', 'sql', 2, a)),
    ...Array.from({ length: 150 }, (_, i) => span(`b${i}`, 'q', 'sql', 0, b)),
    span('p', '1.1', 'phase'),
    span('c', 'p', 'sql', 0, c),
    span('untold', 'q', 'sql'),
  ], { ...options, requested: true })!
  let ran = (id: string) =>
    saved.find((r) =>
      r.entity.eid == derivedEid(`span|${JSON.stringify([options.eid, id])}`)
    )?.statements?.ran
  let row = (sql: string, n: number, rows_read = 0) => ({
    sql,
    n,
    rows_read,
    rows_written: 0,
    ms: n,
  })
  equal(saved.length, 201)
  equal(ran('q'), [row(a, 150, 300), row(b, 150)])
  equal(ran('a0'), [row(a, 1, 2)])
  equal(ran('p'), undefined)
  equal(ran('1.1'), [row(c, 1)])
})
