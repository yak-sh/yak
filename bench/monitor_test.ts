/** What the bench monitor reports, and what it remembers as good, for each
 * sequence of checks a suite can give it. */
import type { Run } from '@yaks/benchmark'
import { equal, test } from '@yaks/testing'
import { type Outcome, type State, watch } from './monitor.ts'

let run = (verdict: Run['verdict'], commit = 'c2'): Run => ({
  version: 1,
  suite: 's',
  metric: 'm',
  workload: 1,
  at: `at-${commit}`,
  commit,
  runtime: 'r',
  cpu: 'c',
  load: [1, 1, 1],
  rounds: 3,
  benches: [],
  tolerance: .1,
  verdict,
  regressions: verdict == 'regressed'
    ? [{
      name: 'task/warm',
      unit: 'ms',
      baseline: 1000,
      limit: 1200,
      current: 1500,
      change: .5,
    }]
    : [],
})
let outcome = (v: Outcome['verdict']): Outcome =>
  v == 'failed' ? { verdict: v, error: 'did not paint' } : {
    verdict: v,
    run: run(v),
  }

// Each suite's checks in order; what was reported (title line), what each
// suite came to, and the good commits remembered after.
let monitor = async (checks: Record<string, Outcome['verdict'][]>) => {
  let state: State = { good: { s: { commit: 'c1', at: 'at-c1' } } }
  let reports: string[] = [], asked: (string | undefined)[] = []
  let runs: (number | undefined)[] = []
  let verdicts = await watch(Object.keys(checks), state, {
    check: (suite, n) => {
      runs.push(n)
      return Promise.resolve(outcome(checks[suite].shift()!))
    },
    report: (error, suite, kind) => {
      reports.push(`${kind} ${suite}: ${error.message.split('\n')[0]}`)
      return Promise.resolve()
    },
    since: (_suite, from) => {
      asked.push(from)
      return Promise.resolve(['c2 the change'])
    },
  })
  let good = Object.fromEntries(
    Object.entries(state.good).map(([k, g]) => [k, g.commit]),
  )
  return { reports, verdicts, good, asked, runs }
}

test('a regression counts only when a check as banked confirms it', async () => {
  equal(await monitor({ s: ['regressed', 'passed'] }), {
    reports: [],
    verdicts: { s: 'passed' },
    good: { s: 'c2' },
    asked: [],
    runs: [1, undefined],
  })
  equal(await monitor({ s: ['regressed', 'regressed'] }), {
    reports: [
      'regressed s: s got slower: task/warm 1,500 ms, over its limit of 1,200 ms (best 1,000 ms)',
    ],
    verdicts: { s: 'regressed' },
    good: { s: 'c1' },
    asked: ['c1'],
    runs: [1, undefined],
  })
})

test('a suite that cannot run is reported, and others still run', async () => {
  equal(await monitor({ s: ['failed'], t: ['passed'] }), {
    reports: ['failed s: s could not be measured: did not paint'],
    verdicts: { s: 'failed', t: 'passed' },
    good: { s: 'c1', t: 'c2' },
    asked: [],
    runs: [1, 1],
  })
})
