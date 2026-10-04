import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import {
  type Deploy,
  latest,
  records,
  run,
  split,
  stages,
  suite,
} from './deploy.ts'
import { type Baseline, Regressed } from '@yaks/benchmark'
import { assertRejects } from '@std/assert'

let row = (seconds: number, n = 0): Deploy => ({
  sha: `${n}`.padStart(40, 'a'),
  pushed: new Date(n * 100_000).toISOString(),
  uploaded: new Date(n * 100_000 + seconds * 500).toISOString(),
  live: new Date(n * 100_000 + seconds * 1000).toISOString(),
  seconds,
})
let history = (...times: number[]) => times.map(row)

test('deploy records: JSONL, blank lines, and unavailable historical live times', () => {
  let old = { ...row(40), live: null, seconds: null, backfill: true }
  assertEquals(
    records(`\n${JSON.stringify(old)}\n\n${JSON.stringify(row(20))}\n`),
    [old, row(20)],
  )
  assertEquals(records(' \n'), [])
})

test('deploy records: corrupt measurements cannot reset the gate', () => {
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

test('deploy stages: the split is arithmetic on the stamps every row already has', () => {
  // Cloudflare owns `upload`, we own `propagate`; the verdict never says which
  // grew unless both are on the line. T-35426's three REGRESSIONs were 40s of
  // upload and two minutes of "propagate" that was the gate's own test suite.
  assertEquals(stages(row(60)), { upload: 30, propagate: 30 })
  assertEquals(split(row(60)), 'upload 30.000s + propagate 30.000s')
  let unverified = { ...row(60), live: null, seconds: null }
  assertEquals(stages(unverified), { upload: 30, propagate: null })
  assertEquals(split(unverified), 'upload 30.000s')
})

let options = (base: Baseline) => ({
  mode: 'check' as const,
  output: 'deploy.results.json',
  baseline: 'deploy.baseline.json',
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

let bank = (): Promise<Baseline> =>
  Deno.readTextFile(new URL('./deploy.baseline.json', import.meta.url)).then(
    JSON.parse,
  )

test('deploy suite: banked push-to-live floor refuses a synthetic regression', async () => {
  let base = await bank()
  let floor = base.benches[0].median
  let check = options(base)
  assertEquals(
    (await run(check, history(floor, floor * 1.25)))?.verdict,
    'passed',
  )
  await assertRejects(
    () => run(check, history(floor, floor * 1.251)),
    Regressed,
  )
  assertEquals(base.benches[0].median, floor)
})

test('deploy suite: the strict 60s ceiling uses the same ratchet', async () => {
  let base = await bank()
  base.benches[0].median = 50
  let check = options(base)
  assertEquals((await run(check, history(50, 59.999)))?.verdict, 'passed')
  let error = await assertRejects(() => run(check, history(50, 60)), Regressed)
  assertEquals((error as Regressed).result.regressions.map((r) => r.name), [
    '60s budget exceeded',
  ])
})

test('deploy suite: upload order, completed observations and backfills choose the checked deploy', () => {
  let measured = history(40, 20, 30)
  let historical = { ...row(900, 3), backfill: true }
  assertEquals(latest([...measured.reverse(), historical])?.seconds, 30)
  assertEquals(suite([historical]), null)
  let failed = { ...row(40, 4), seconds: null, live: null }
  assertThrows(
    () => suite([...measured, failed]),
    Error,
    'no verified live response',
  )
  assertEquals(latest([...measured, failed, row(40, 4)])?.seconds, 40)
})

test('deploy acceptance cannot weaken the strict 60s budget', async () => {
  let base = await bank()
  await assertRejects(
    () =>
      run({ ...options(base), mode: 'accept', tolerance: .25 }, history(60)),
    Error,
    'Cannot accept',
  )
})
