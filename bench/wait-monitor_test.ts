/** A failed isolated wait cannot disappear behind the suite beside it. */
import { equal, test } from '@yaks/testing'
import { HOURLY, SUITES, watch } from './monitor.ts'
let families = [
  'operation-commands',
  'operation-scale',
  'hook-waits',
  'terminal-interactions',
]
let reported: string[] = []
let verdicts = await watch(families, { good: {} }, {
  check: () =>
    Promise.resolve({ verdict: 'failed', error: 'fixture did not complete' }),
  since: () => Promise.resolve([]),
  report: (_error, suite) => {
    reported.push(suite)
    return Promise.resolve()
  },
})
test('every isolated wait failure reaches its half-hour monitor lane', () => {
  equal(reported, families)
  equal(Object.values(verdicts), families.map(() => 'failed'))
  equal(
    families.every((name) => HOURLY.includes(name) && SUITES.includes(name)),
    true,
  )
})
