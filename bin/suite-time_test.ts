import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { ratchet, record, type Sample, timed, VERSION } from './suite-time.ts'

const sample = (seconds = 10, controlSeconds = 0.05, code = 0): Sample => ({
  seconds,
  controlSeconds,
  code,
  samples: 10,
  at: '2026-09-11T00:00:00Z',
})
const baseline = { ratio: 200, controlFloorSeconds: 0.05 }

Deno.test('suite ratchet cancels 2x load, reports real slowdown, and never banks loaded gains', () => {
  assertEquals(ratchet(sample(20, 0.1), baseline).verdict, 'HELD')
  assertEquals(ratchet(sample(26, 0.1), baseline).verdict, 'REGRESSION')
  assertEquals(ratchet(sample(15, 0.1), baseline).baseline, baseline)
  assertEquals(ratchet(sample(8), baseline).baseline?.ratio, 160)
  assertEquals(ratchet(sample(12.5), baseline).verdict, 'HELD')
})
Deno.test('new metrics, explicit acceptance, and failed commands', () => {
  assertEquals(ratchet(sample(), undefined).verdict, 'NEW')
  assertEquals(ratchet(sample(30), baseline, 0.25, true).baseline?.ratio, 600)
  assertEquals(
    ratchet(sample(1, 0.05, 7), baseline, 0.25, true).baseline,
    baseline,
  )
  assertEquals(ratchet(sample(1, 0.05, 7), undefined).baseline, undefined)
  assertThrows(() => ratchet(sample(0), baseline))
  assertThrows(() => ratchet(sample(), baseline, NaN))
})
Deno.test('results preserve bench data and other suites; committed floors survive results deletion', async () => {
  let dir = await Deno.makeTempDir()
  let path = dir + '/results.json'
  try {
    Deno.writeTextFileSync(path, JSON.stringify({ ns: { point: 42 } }))
    record(path, 'check', sample())
    record(path, 'test', sample())
    let data = JSON.parse(Deno.readTextFileSync(path))
    assertEquals(data.ns, { point: 42 })
    assertEquals(data.suiteTimings.suites.check.latest.seconds, 10)
    assertEquals(data.suiteTimings.suites.test.latest.seconds, 10)
    Deno.removeSync(path)
    record(path, 'check', sample(30))
    data = JSON.parse(Deno.readTextFileSync(path))
    assertEquals(data.suiteTimings.suites.check.latest.verdict, 'REGRESSION')
    assertEquals(data.suiteTimings.suites.check.baseline.ratio, 200)
    let basePath = dir + '/suite.baseline.json'
    let base = JSON.parse(Deno.readTextFileSync(basePath))
    base.version = VERSION - 1
    Deno.writeTextFileSync(basePath, JSON.stringify(base))
    record(path, 'check', sample(30))
    data = JSON.parse(Deno.readTextFileSync(path))
    assertEquals(data.suiteTimings.suites.check.latest.verdict, 'NEW')
    assertEquals(data.suiteTimings.suites.check.baseline.ratio, 600)
    Deno.writeTextFileSync(path, '{bad')
    assertThrows(() => record(path, 'check', sample()))
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
Deno.test('timer preserves nonzero command status and handles short commands', async () => {
  let result = await timed(Deno.execPath(), ['eval', 'Deno.exit(7)'])
  assertEquals(result.code, 7)
  assertEquals(result.samples > 0, true)
  assertEquals(result.controlSeconds > 0, true)
  await assertRejects(() => timed('/nonexistent-suite-command', []))
})
