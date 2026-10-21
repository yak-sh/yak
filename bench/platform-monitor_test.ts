/** A slowdown in an individual dashboard operation must reach the same
 * bounded half-hour reporting lane as the suite's retained operations. */
import { equal, test } from '@yaks/testing'
import { compare, type Run } from '@yaks/benchmark'
import { HOURLY, SUITES, watch } from './monitor.ts'
import { NAMES } from './platform-waits.ts'
let bank = JSON.parse(
  await Deno.readTextFile(
    new URL('./platform-waits.baseline.json', import.meta.url),
  ),
)
let cases = []
for (
  let name of NAMES.filter((n) =>
    n.startsWith('form/') ||
    n.includes('/paint-') && n.startsWith('management/')
  )
) {
  let current = {
    at: 'isolated-proof',
    commit: 'proof',
    load: [0, 0, 0],
    cpus: 4,
    ...bank,
    benches: bank.benches.map((b: { name: string; median: number }) => ({
      ...b,
      median: b.name == name ? b.median + 1 : b.median,
    })),
  } as Run
  let regressions = compare(bank, current)
  let reports: string[] = [], checks = 0
  let outcome = await watch(['platform-waits'], { good: {} }, {
    check: () => {
      checks++
      return Promise.resolve({
        verdict: 'regressed',
        run: { ...current, regressions },
      })
    },
    report: (_error, suite) => {
      reports.push(suite)
      return Promise.resolve()
    },
    since: () => Promise.resolve([]),
  })
  cases.push({
    name,
    regressions: regressions.map((r) => r.name),
    reports,
    checks,
    verdict: outcome['platform-waits'],
  })
}
test('every dashboard paint and form regression is confirmed and reported', () => {
  equal(
    HOURLY.includes('platform-waits') && SUITES.includes('platform-waits'),
    true,
  )
  for (let c of cases) {
    equal(c.regressions, [c.name])
    equal(c.reports, ['platform-waits'])
    equal(c.checks, 2)
    equal(c.verdict, 'regressed')
  }
})
