import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { records, type Row, run, suite } from './app-deploy.ts'
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
  files3: { call: stat(live - 100), live: stat(live) },
  deploy: { call: stat(live) },
  single: { call: stat(live - 100), live: stat(live) },
  ...more,
})

test('app deploy records: JSONL, blank lines, corrupt rows refused', () => {
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

test('app deploy suite: each banked workload refuses a synthetic regression', async () => {
  let base: Baseline = JSON.parse(
    await Deno.readTextFile(
      new URL('./app-deploy.baseline.json', import.meta.url),
    ),
  )
  let normal = row(2106, 1, {
    deploy: { call: stat(2730) },
    single: { call: stat(1584), live: stat(1684) },
  })
  assertEquals((await run(options(base), [normal]))?.verdict, 'passed')
  let slower = [
    { ...normal, files3: { ...normal.files3, live: stat(2106 * 1.3) } },
    { ...normal, deploy: { call: stat(2730 * 1.3) } },
    { ...normal, single: { ...normal.single, live: stat(1684 * 1.3) } },
  ]
  for (let [i, slow] of slower.entries()) {
    let error = await assertRejects(() => run(options(base), [slow]), Regressed)
    assertEquals((error as Regressed).result.regressions.map((r) => r.name), [
      base.benches[i].name,
    ])
  }
})

test('app deploy limits retain integer millisecond rounding', async () => {
  let base: Baseline = JSON.parse(
    await Deno.readTextFile(
      new URL('./app-deploy.baseline.json', import.meta.url),
    ),
  )
  for (let [files, deploy] of [[2633, 2730], [2106, 3413]]) {
    let atLimit = row(files, 1, {
      deploy: { call: stat(deploy) },
      single: { call: stat(1584), live: stat(1684) },
    })
    assertEquals((await run(options(base), [atLimit]))?.verdict, 'passed')
    let over = files == 2633
      ? { ...atLimit, files3: { ...atLimit.files3, live: stat(files + 1) } }
      : { ...atLimit, deploy: { call: stat(deploy + 1) } }
    await assertRejects(() => run(options(base), [over]), Regressed)
  }
})

test('app deploy suite checks only the latest host, with new hosts unbanked', async () => {
  let work = suite([
    row(3000),
    row(2500, 1),
    row(9000, 2, { host: 'yaks.fyi' }),
  ])!
  let current = await work.collect(0)
  assertEquals(Object.keys(current), [
    'yaks.fyi/files → live',
    'yaks.fyi/deploy',
    'yaks.fyi/one file → live',
  ])
  assertEquals(
    (current['yaks.fyi/files → live'] as { value: number }).value,
    9000,
  )
  assertEquals(suite([]), null)

  let base: Baseline = JSON.parse(
    await Deno.readTextFile(
      new URL('./app-deploy.baseline.json', import.meta.url),
    ),
  )
  let staging = {
    ...base.benches[0],
    name: 'yaks.fyi/files → live',
    median: 100,
  }
  base.benches.push(staging)
  // Staging's old slow measurement does not change a later production verdict.
  assertEquals(
    (await run(options(base), [
      row(9000, 1, { host: 'yaks.fyi' }),
      row(2106, 2, {
        deploy: { call: stat(2730) },
        single: { call: stat(1584), live: stat(1684) },
      }),
    ]))?.verdict,
    'passed',
  )
  assertEquals(
    (await run(options(base), [
      row(9000, 3, { host: 'new.example' }),
    ]))?.verdict,
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
