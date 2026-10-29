import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { records, type Row, run, suite, WAITS } from './app-deploy.ts'
import { medians, stages, stats } from '../bin/app-deploy-time.ts'

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
  ship: { write: stat(live / 2), deploy: stat(live / 2), live: stat(live) },
  edit: { write: stat(live / 2), deploy: stat(live / 2), live: stat(live) },
  ...more,
})

test('app deploy records: JSONL, blank lines, corrupt rows refused, staged-era rows unread', () => {
  let a = row(3000), b = row(2500, 1)
  assertEquals(
    records(`\n${JSON.stringify(a)}\n\n${JSON.stringify(b)}\n`),
    [a, b],
  )
  assertEquals(records(' \n'), [])
  let old = { ...a, files3: { call: stat(1), live: stat(1) } }
  assertEquals(records(JSON.stringify(old)), [])
  for (
    let bad of [
      null,
      {},
      { ...a, at: 'yesterday' },
      { ...a, host: '' },
      { ...a, runs: 0 },
      { ...a, version: 7 },
      { ...a, edit: {} },
      { ...a, ship: { ...a.ship, live: { median: -1, p95: 1, n: 1 } } },
    ]
  ) {
    assertThrows(() => records(JSON.stringify(bad)), Error, ':1: invalid')
  }
})

test('server-timing: stages parsed, medians per stage, absent header is empty', () => {
  assertEquals(
    stages('inApp;dur=120, pin;dur=300, put;dur=210;desc=r2, total;dur=900'),
    { inApp: 120, pin: 300, put: 210, total: 900 },
  )
  assertEquals(stages(null), {})
  assertEquals(
    medians([{ a: 1, b: 10 }, { a: 3 }, { a: 2, b: 20 }]),
    { a: 2, b: 20 },
  )
  assertEquals(stats([5, 1, 3]), { median: 3, p95: 5, n: 3 })
})
test('app deploy diagnostics retain the latest host observation without judging wall waits', async () => {
  let work = suite([
    row(3000),
    row(2500, 1),
    row(9000, 2, { host: 'yaks.fyi' }),
  ])!
  let current = await work.collect(0)
  assertEquals(
    Object.keys(current),
    Object.keys(WAITS).map((n) => `yaks.fyi/${n}`),
  )
  assertEquals(
    (current['yaks.fyi/ship → live'] as { value: number }).value,
    9000,
  )
  assertEquals(suite([]), null)
  let wrote: string[] = []
  let result = await run({
    mode: 'check',
    figure: 'cpu',
    output: 'app-deploy.results.json',
    baseline: 'app-deploy.baseline.json',
    host: () => ({
      config: {},
      configURL: null,
      commit: null,
      runtime: 'test',
      cpu: 'test',
      load: [],
    }),
    files: {
      read: () => {
        throw new Error('waiting diagnostics have no baseline')
      },
      write: (path: string) => {
        wrote.push(path)
        return Promise.resolve()
      },
    },
  }, [row(9000)])
  assertEquals(result?.verdict, 'measured')
  assertEquals(wrote, ['app-deploy.results.json'])
})
