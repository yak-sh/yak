import { assertEquals, assertThrows } from '@std/assert'
import { type Deploy, gate, records } from './deploy-gate.ts'

let row = (seconds: number, n = 0): Deploy => ({
  sha: `${n}`.padStart(40, 'a'),
  pushed: new Date(n * 100_000).toISOString(),
  uploaded: new Date(n * 100_000 + seconds * 500).toISOString(),
  live: new Date(n * 100_000 + seconds * 1000).toISOString(),
  seconds,
})
let history = (...times: number[]) => times.map(row)

Deno.test('deploy records: JSONL, blank lines, and unavailable historical live times', () => {
  let old = { ...row(40), live: null, seconds: null, backfill: true }
  assertEquals(
    records(`\n${JSON.stringify(old)}\n\n${JSON.stringify(row(20))}\n`),
    [old, row(20)],
  )
  assertEquals(records(' \n'), [])
})

Deno.test('deploy records: corrupt measurements cannot reset the gate', () => {
  for (
    let bad of [
      null,
      [],
      {},
      { ...row(20), sha: 'not a sha' },
      { ...row(20), sha: [row(20).sha] },
      { ...row(20), pushed: 'yesterday' },
      { ...row(20), uploaded: '1969-01-01' },
      { ...row(20), live: '1970-01-01T00:00:01Z' },
      { ...row(20), seconds: -1 },
      { ...row(0), seconds: -0.0005 },
      { ...row(20), seconds: 21 },
      { ...row(20), seconds: '20' },
      { ...row(20), live: null },
      { ...row(20), backfill: 'false' },
      { ...row(20), estimated: 1 },
    ]
  ) {
    assertThrows(
      () => records(JSON.stringify(bad)),
      Error,
      ':1: invalid deploy record',
    )
  }
  assertThrows(
    () => records(`${JSON.stringify(row(20))}\n{broken`),
    Error,
    ':2:',
  )
})

Deno.test('deploy gate: no data and the first measurement bootstrap without blocking', () => {
  assertEquals(gate([]).code, 0)
  assertEquals(gate([]).floor, null)
  assertEquals(gate(history(80)).code, 0)
  assertEquals(gate(history(80)).limit, 60)
})

Deno.test('deploy gate: the bench margin is inclusive, regressions never raise the floor', () => {
  for (
    let [times, floor, code] of [
      [[40, 50], 40, 0],
      [[40, 50.001], 40, 1],
      [[40, 20], 20, 0],
      [[40, 20, 25], 20, 0],
      [[40, 20, 40], 20, 1],
      [[40, 20, 40, 21], 20, 0],
      [[50, 59.999], 50, 0],
      [[50, 60], 50, 1],
    ] as [number[], number, number][]
  ) {
    let result = gate(history(...times))
    assertEquals([result.floor, result.code], [floor, code], `${times}`)
  }
  assertEquals(gate(history(20, 23), 0.1).code, 1)
  for (let margin of [-1, NaN, Infinity]) assertThrows(() => gate([], margin))
})

Deno.test('deploy gate: upload order matters; historical observations cannot ratchet or hide failures', () => {
  assertEquals(gate(history(40, 20, 30).reverse()).code, 1)
  let historical = { ...row(900, 3), backfill: true }
  assertEquals(gate([historical]).floor, null)
  assertEquals(gate([...history(40, 20, 30), historical]).code, 1)
  let failed = { ...row(40, 4), seconds: null, live: null }
  assertEquals(gate([...history(40, 20), failed]).code, 1)
  assertEquals(gate([failed]).code, 1)
  // An older push may finish after a newer one: the last upload is gated.
  let late = { ...row(80), uploaded: '1970-01-01T00:00:40Z' }
  let early = {
    ...row(20, 1),
    pushed: '1970-01-01T00:00:05Z',
    uploaded: '1970-01-01T00:00:15Z',
    live: '1970-01-01T00:00:25Z',
  }
  assertEquals(gate([late, early]).code, 1)
})
