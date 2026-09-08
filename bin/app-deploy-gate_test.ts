import { assertEquals, assertThrows } from '@std/assert'
import { gate, records, type Row } from './app-deploy-gate.ts'
import { medians, stages, stats } from './app-deploy-time.ts'

let stat = (median: number) => ({ median, p95: median, n: 5 })
let row = (
  live: number,
  n = 0,
  more: Partial<Row> = {},
): Row => ({
  at: new Date(n * 60_000).toISOString(),
  host: 'yaks.app',
  version: null,
  runs: 5,
  files3: { call: stat(live - 100), live: stat(live) },
  deploy: { call: stat(live) },
  single: { call: stat(live - 100), live: stat(live) },
  ...more,
})
let history = (...lives: number[]) => lives.map((l, i) => row(l, i))

Deno.test('app deploy records: JSONL, blank lines, corrupt rows refused', () => {
  let a = row(3000), b = row(2500, 1)
  assertEquals(
    records(`\n${JSON.stringify(a)}\n\n${JSON.stringify(b)}\n`),
    [a, b],
  )
  assertEquals(records(' \n'), [])
  for (
    let bad of [
      null,
      {},
      { ...a, at: 'yesterday' },
      { ...a, host: '' },
      { ...a, runs: 0 },
      { ...a, version: 7 },
      { ...a, deploy: {} },
      { ...a, files3: { ...a.files3, live: { median: -1, p95: 1, n: 1 } } },
    ]
  ) {
    assertThrows(() => records(JSON.stringify(bad)), Error, ':1: invalid')
  }
})

Deno.test('app deploy gate: bootstrap passes, the band is inclusive, the floor only falls', () => {
  assertEquals(gate([]).code, 0)
  assertEquals(gate(history(3000)).code, 0)
  for (
    let [lives, code] of [
      [[3000, 3750], 0],
      [[3000, 3751], 1],
      [[3000, 2000], 0],
      [[3000, 2000, 2500], 0],
      [[3000, 2000, 3000], 1],
      [[3000, 2000, 3000, 2100], 0],
    ] as [number[], number][]
  ) {
    assertEquals(gate(history(...lives)).code, code, `${lives}`)
  }
  assertEquals(gate(history(3000, 3400), 0.1).code, 1)
  for (let margin of [-1, NaN, Infinity]) assertThrows(() => gate([], margin))
})

Deno.test('app deploy gate: one number regressing fails; hosts never compare', () => {
  let slowDeploy = row(2000, 1, { deploy: { call: stat(4000) } })
  assertEquals(gate([row(3000), slowDeploy]).code, 1)
  let staging = row(9000, 1, { host: 'yaks.fyi' })
  assertEquals(gate([row(3000), staging]).code, 0)
  // Ordered by time, not by position in the file.
  assertEquals(gate([row(4000, 1), row(3000, 0)]).code, 1)
})

Deno.test('server-timing: stages parsed, medians per stage, absent header is empty', () => {
  assertEquals(
    stages('inApp;dur=120, pin;dur=300, put;dur=210;desc=r2, all;dur=900'),
    { inApp: 120, pin: 300, put: 210, all: 900 },
  )
  assertEquals(stages(null), {})
  assertEquals(
    medians([{ a: 1, b: 10 }, { a: 3 }, { a: 2, b: 20 }]),
    { a: 2, b: 20 },
  )
  assertEquals(stats([5, 1, 3]), { median: 3, p95: 5, n: 3 })
})
