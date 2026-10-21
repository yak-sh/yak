import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { GATED, records, type Row, run, suite } from './app-deploy.ts'
import { type Baseline, Regressed } from '@yaks/benchmark'
import { assertRejects } from '@std/assert'
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
let options = (base: Baseline) => ({
  mode: 'check' as const,
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
    read: () => Promise.resolve(JSON.stringify(base)),
    write: () => Promise.resolve(),
  },
})

// A baseline banking exactly this row's gated medians.
let banked = (r: Row): Baseline => ({
  version: 1,
  suite: 'app-deploy',
  metric: 'latest-host-medians',
  workload: 1,
  runtime: 'Cloudflare Workers',
  cpu: 'Cloudflare',
  tolerance: 0.25,
  benches: Object.entries(GATED).map(([name, of]) => ({
    name: `${r.host}/${name}`,
    unit: 'ms',
    resolution: 1,
    better: 'lower' as const,
    median: of(r),
  })),
})

let slots = {
  'ship → live': ['ship', 'live'],
  'ship deploy': ['ship', 'deploy'],
  'edit → live': ['edit', 'live'],
} as const

// The row with one gated number, by name, set to `ms`.
let setting = (r: Row, name: keyof typeof GATED, ms: number): Row => {
  let [k, p] = slots[name]
  return { ...r, [k]: { ...r[k], [p]: stat(ms) } }
}

test('app deploy suite: each banked workload refuses a synthetic regression', async () => {
  let normal = row(2000, 1)
  let base = banked(normal)
  assertEquals((await run(options(base), [normal]))?.verdict, 'passed')
  for (let name of Object.keys(GATED) as (keyof typeof GATED)[]) {
    let slow = setting(normal, name, GATED[name](normal) * 1.3)
    let error = await assertRejects(() => run(options(base), [slow]), Regressed)
    assertEquals((error as Regressed).result.regressions.map((r) => r.name), [
      `yaks.app/${name}`,
    ])
  }
})

test('app deploy limits retain integer millisecond rounding', async () => {
  let normal = row(2106, 1)
  let base = banked(normal)
  // 25% over 2106 is 2632.5, which rounds to 2633 and passes; 2634 does not.
  let at = setting(normal, 'ship → live', 2633)
  assertEquals((await run(options(base), [at]))?.verdict, 'passed')
  await assertRejects(
    () => run(options(base), [setting(normal, 'ship → live', 2634)]),
    Regressed,
  )
})

test('app deploy suite checks only the latest host, with new hosts unbanked', async () => {
  let work = suite([
    row(3000),
    row(2500, 1),
    row(9000, 2, { host: 'yaks.fyi' }),
  ])!
  let current = await work.collect(0)
  assertEquals(
    Object.keys(current),
    Object.keys(GATED).map((n) => `yaks.fyi/${n}`),
  )
  assertEquals(
    (current['yaks.fyi/ship → live'] as { value: number }).value,
    9000,
  )
  assertEquals(suite([]), null)

  let normal = row(2000, 1)
  let base = banked(normal)
  // Staging's old slow measurement does not change a later production verdict.
  base.benches.push({
    ...base.benches[0],
    name: 'yaks.fyi/ship → live',
    median: 100,
  })
  assertEquals(
    (await run(options(base), [row(9000, 1, { host: 'yaks.fyi' }), normal]))
      ?.verdict,
    'passed',
  )
  assertEquals(
    (await run(options(base), [row(9000, 3, { host: 'new.example' })]))
      ?.verdict,
    'measured',
  )

  let stored = JSON.stringify(base)
  let opt = {
    ...options(base),
    mode: 'accept' as const,
    tolerance: .25,
    files: {
      read: () => Promise.resolve(stored),
      write: (path: string, value: unknown) => {
        if (path == 'app-deploy.baseline.json') stored = JSON.stringify(value)
        return Promise.resolve()
      },
    },
  }
  await run(opt, [row(9000, 3, { host: 'new.example' })])
  assertEquals(
    (JSON.parse(stored) as Baseline).benches.filter((b) =>
      !b.name.startsWith('new.example/')
    ),
    base.benches,
  )
})
