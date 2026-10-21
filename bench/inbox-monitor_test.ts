/** Inbox failures and confirmed regressions reach the unattended monitor. */
import { type Outcome, watch } from './monitor.ts'
import { suite } from './inbox-content.ts'
import { type Run } from '@yaks/benchmark'
import { equal, test } from '@yaks/testing'

let measured = suite()
let reported: string[] = [], checks: (number | undefined)[] = []
let result = (verdict: 'passed' | 'regressed'): Outcome => ({
  verdict,
  run: {
    version: 1,
    suite: measured.name,
    metric: measured.metric,
    workload: measured.workload,
    at: 'fixture',
    commit: 'fixture',
    runtime: 'fixture',
    cpu: 'fixture',
    load: [0, 0, 0],
    stall: null,
    rounds: 3,
    verdict,
    tolerance: 0,
    benches: [],
    regressions: verdict == 'regressed'
      ? [{
        name: 'person-inbox/cold',
        unit: 'ms',
        baseline: 100,
        current: 101,
        limit: 100,
        change: 1,
      }]
      : [],
  } as Run,
})
let monitor = {
  check: (_suite: string, n?: number) => {
    checks.push(n)
    return Promise.resolve(result('regressed'))
  },
  report: (error: Error) => {
    reported.push(error.message)
    return Promise.resolve()
  },
  since: () => Promise.resolve([]),
}

test('Inbox monitor confirms best-of-three and reports a one-ms regression without slack', async () => {
  let out = await watch([measured.name], { good: {} }, monitor)
  equal(out, { 'inbox-content': 'regressed' })
  equal(checks, [1, undefined])
  equal(reported.length, 1)
  equal(reported[0].includes('over its limit of 100 ms'), true)
})

let failures: string[] = []
test('Inbox missing content reports a failed suite rather than banking Show', async () => {
  let out = await watch([measured.name], { good: {} }, {
    check: () =>
      Promise.resolve({
        verdict: 'failed' as const,
        error: 'Inbox content never painted',
      }),
    report: (error) => {
      failures.push(error.message)
      return Promise.resolve()
    },
    since: () => Promise.resolve([]),
  })
  equal(out, { 'inbox-content': 'failed' })
  equal(failures, [
    'inbox-content could not be measured: Inbox content never painted',
  ])
})
