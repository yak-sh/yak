/** What the bench monitor reports, and what it remembers as good, for each
 * sequence of checks a suite can give it. */
import type { Run } from '@yaks/benchmark'
import { equal, test } from '@yaks/testing'
import { committed, type Outcome, type State, watch } from './monitor.ts'

let steps = await committed('harness-steps')
let expected = JSON.parse(
  await Deno.readTextFile(
    new URL('../packages/harness/steps.baseline.json', import.meta.url),
  ),
)
test('the monitor reads a suite baseline outside bench', () => {
  equal(steps, expected)
})

let run = (
  verdict: Run['verdict'],
  commit = 'c2',
  stall: number | null = null,
): Run => ({
  version: 1,
  suite: 's',
  metric: 'm',
  workload: 1,
  at: `at-${commit}`,
  commit,
  runtime: 'r',
  cpu: 'c',
  load: [1, 1, 1],
  stall,
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
  v == 'failed'
    ? { verdict: v, error: 'did not paint' }
    : v == 'passed' || v == 'measured' || v == 'regressed'
    ? { verdict: v, run: run(v) }
    : { verdict: v }

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

test('a thrown check is reported and cannot hide the next suite', async () => {
  let reports: string[] = []
  let out = await watch(['broken', 'good'], { good: {} }, {
    check: (suite) => {
      if (suite == 'broken') throw new Error('baseline missing')
      return Promise.resolve(outcome('passed'))
    },
    since: () => Promise.resolve([]),
    report: (error) => {
      reports.push(error.message)
      return Promise.resolve()
    },
  })
  equal(out, { broken: 'failed', good: 'passed' })
  equal(reports, ['broken could not be measured: baseline missing'])
})

test('confirmed measurements bank drops even when another metric regressed', async () => {
  let banked: string[] = []
  await watch(['s'], { good: {} }, {
    check: () => Promise.resolve(outcome('regressed')),
    since: () => Promise.resolve([]),
    report: () => Promise.resolve(),
    bank: (suite, run) => {
      banked.push(`${suite}:${run.verdict}`)
      return Promise.resolve()
    },
  })
  equal(banked, ['s:regressed'])
})

test('a busy measurement lock defers without reporting, banking, or marking good', async () => {
  let state: State = { good: { s: { commit: 'c1', at: 'at-c1' } } }
  let banked: string[] = [], reports: string[] = []
  let verdicts = await watch(['s', 't'], state, {
    check: (suite) =>
      Promise.resolve(outcome(suite == 's' ? 'deferred' : 'passed')),
    since: () => Promise.resolve([]),
    bank: (suite) => {
      banked.push(suite)
      return Promise.resolve()
    },
    report: (error) => {
      reports.push(error.message)
      return Promise.resolve()
    },
  })
  equal(verdicts, { s: 'deferred', t: 'passed' })
  equal(state.good.s, { commit: 'c1', at: 'at-c1' })
  equal(state.good.t, { commit: 'c2', at: 'at-c2' })
  equal(banked, ['t'])
  equal(reports, [])
})

test('a deferred confirmation cannot confirm the screening regression', async () => {
  equal(await monitor({ s: ['regressed', 'deferred'] }), {
    reports: [],
    verdicts: { s: 'deferred' },
    good: { s: 'c1' },
    asked: [],
    runs: [1, undefined],
  })
})

test('a loaded box is not confirmed, reported or banked', async () => {
  equal(await monitor({ s: ['regressed', 'loaded'], t: ['loaded'] }), {
    reports: [],
    verdicts: { s: 'loaded', t: 'loaded' },
    good: { s: 'c1' },
    asked: [],
    runs: [1, undefined, 1],
  })
})

test('a pass on a box that grew loaded marks the suite good but banks nothing', async () => {
  let state: State = { good: {} }, banked: string[] = []
  await watch(['s'], state, {
    check: () =>
      Promise.resolve({ verdict: 'passed', run: run('passed', 'c3', .3) }),
    since: () => Promise.resolve([]),
    report: () => Promise.resolve(),
    bank: (suite) => {
      banked.push(suite)
      return Promise.resolve()
    },
  })
  equal([state.good.s?.commit, banked], ['c3', []])
})

for (let verdict of ['loaded', 'unconfirmed', 'inconclusive'] as const) {
  test(`${verdict} is neither a budget pass nor a new best`, async () => {
    let state: State = { good: { s: { commit: 'old', at: 'then' } } }
    let banked = false, reported = false
    equal(
      await watch(['s'], state, {
        check: () => Promise.resolve({ verdict }),
        since: () => Promise.resolve([]),
        bank: () => {
          banked = true
          return Promise.resolve()
        },
        report: () => {
          reported = true
          return Promise.resolve()
        },
      }),
      { s: verdict },
    )
    equal(state.good.s, { commit: 'old', at: 'then' })
    equal(banked, false)
    equal(reported, false)
  })
}
