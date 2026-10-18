/** What the bench monitor reports, and what it remembers as good, for each
 * sequence of checks a suite can give it. */
import type { Run } from '@yaks/benchmark'
import { clock, equal, ok, test } from '@yaks/testing'
import {
  HOURLY,
  measurement,
  type Outcome,
  type State,
  watch,
  WINDOW,
} from './monitor.ts'

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
  v == 'deferred' || v == 'unconfirmed' || v == 'inconclusive'
    ? { verdict: v }
    : v == 'failed'
    ? { verdict: v, error: 'did not paint' }
    : {
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

for (let verdict of ['unconfirmed', 'inconclusive'] as const) {
  test(`paired ${verdict} is neither a budget pass nor a new best`, async () => {
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

// Model the process boundary, not wall time: flock consumes the same absolute
// allowance as collection, and timeout's kill grace is charged before returning.
let scheduled = async (busy: boolean, duration: number, suites = HOURLY) => {
  let time = clock(30 * 60_000) // a change immediately after the preceding tick
  let start = time.now(), deadline = start + WINDOW
  let reports: { suite: string; kind: string; at: number; message: string }[] =
    []
  let calls: { suite: string; runs?: number; at: number }[] = []
  let banked: string[] = []
  let deadlines = new Map<string, number>()
  let state: State = { good: {} }
  let verdicts = await watch(suites, state, {
    check: async (suite, runs, end) => {
      ok(end! <= deadline)
      if (deadlines.has(suite)) equal(end, deadlines.get(suite))
      deadlines.set(suite, end!)
      let args = measurement(suite, end, time.now())
      if (!args) return { verdict: 'failed', error: 'deadline reached' }
      calls.push({ suite, runs, at: time.now() })
      // Emulate the timeout/flock process seam, including a stubborn child.
      equal(args[0], 'timeout')
      equal(args[3], 'flock')
      let remaining = Number(args[2].slice(0, -1)) * 1000
      let work = busy ? Infinity : duration
      await time.advance(Math.min(work, remaining + 10_000))
      if (busy || duration > 600_000 || work >= remaining) {
        return {
          verdict: 'failed',
          error: 'measurement or lock wait timed out',
        }
      }
      return outcome('regressed')
    },
    bank: (suite) => {
      banked.push(suite)
      return Promise.resolve()
    },
    since: () => Promise.resolve([]),
    report: async (error, suite, kind) => {
      // Include reporting overhead rather than pretending it is free.
      await time.advance(1000)
      reports.push({ suite, kind, at: time.now(), message: error.message })
    },
  }, { deadline, now: time.now })
  return {
    start,
    deadline,
    reports,
    calls,
    banked,
    state,
    verdicts,
    elapsed: time.now(),
  }
}

test('worst-case hourly collection reports every queued suite within the hour', async () => {
  let result = await scheduled(false, 599_000)
  equal(result.reports.map((r) => r.suite), HOURLY)
  equal(result.calls.map((c) => [c.suite, c.runs]), HOURLY.map((s) => [s, 1]))
  equal(result.banked, [])
  ok(result.reports.every((r) => r.kind == 'failed'))
  ok(Object.values(result.verdicts).every((v) => v != 'deferred'))
  ok(result.elapsed < 60 * 60_000)
  equal(result.state.good, {})
})

test('a box lock held beyond the deadline reports all suites, never a silent deferral', async () => {
  let result = await scheduled(true, 0)
  equal(result.calls.length, HOURLY.length)
  equal(result.reports.map((r) => r.suite), HOURLY)
  ok(result.reports.every((r) => r.kind == 'failed'))
  ok(result.reports.every((r) => r.message.includes('could not be measured')))
  equal(result.banked, [])
  equal(result.state.good, {})
  ok(result.elapsed < 60 * 60_000)
})

test('checks hitting their existing ten-minute cap cannot hold up later reports', async () => {
  let result = await scheduled(false, Infinity)
  equal(result.reports.map((r) => r.suite), HOURLY)
  ok(result.reports.every((r) => r.kind == 'failed'))
  equal(result.banked, [])
  ok(result.elapsed < 60 * 60_000)
})

test('slow predecessors leave hook screening and confirmation a turn in the same tick', async () => {
  let time = clock(), state: State = { good: {} }
  let calls: string[] = [], reports: string[] = []
  let suites = HOURLY
  let verdicts = await watch(suites, state, {
    check: async (suite, runs, deadline) => {
      calls.push(suite)
      let args = measurement(suite, deadline, time.now())
      if (!args) return { verdict: 'failed', error: 'no time left' }
      let available = Number(args[2].slice(0, -1)) * 1000
      let work = suite == 'hook-waits' ? (runs ? 25_000 : 75_000) : 599_000
      await time.advance(Math.min(work, available + 10_000))
      return work >= available
        ? { verdict: 'failed', error: 'timed out' }
        : outcome(suite == 'hook-waits' && !runs ? 'passed' : 'regressed')
    },
    since: () => Promise.resolve([]),
    report: (_error, suite) => {
      reports.push(suite)
      return Promise.resolve()
    },
  }, { deadline: WINDOW, now: time.now })
  equal(verdicts['hook-waits'], 'passed')
  equal(calls.filter((s) => s == 'hook-waits').length, 2)
  equal(reports, suites.filter((s) => s != 'hook-waits'))
  equal(state.good['hook-waits'].commit, 'c2')
  ok(time.now() <= WINDOW)
})

test('scheduled busy confirmations are failures, not confirmed regressions or good runs', async () => {
  let reports: string[] = [], calls = 0, banked = 0
  let state: State = { good: {} }, time = clock()
  equal(
    await watch(['s'], state, {
      check: () =>
        Promise.resolve(outcome(++calls == 1 ? 'regressed' : 'deferred')),
      since: () => Promise.resolve([]),
      bank: () => {
        banked++
        return Promise.resolve()
      },
      report: (error, _suite, kind) => {
        reports.push(kind + ': ' + error.message)
        return Promise.resolve()
      },
    }, { deadline: WINDOW, now: time.now }),
    { s: 'failed' },
  )
  equal(calls, 2)
  equal(banked, 0)
  equal(state.good, {})
  equal(reports.length, 1)
  ok(reports[0].includes('confirmation unavailable'))
})

test('fast scheduled suites still screen and confirm without changing measurement limits', async () => {
  let result = await scheduled(false, 1000, [HOURLY[0]])
  equal(result.calls.length, 2)
  equal(result.banked, [HOURLY[0]])
  ok(result.reports.every((r) => r.kind == 'regressed'))
  equal(measurement('pages', 10_000, 0), undefined)
  // Lock wait and collection are inside one process-group timeout. The cap
  // cannot exceed the existing collection limit, or the remaining deadline.
  equal(measurement('pages', WINDOW, 0), [
    'timeout',
    '--kill-after=10',
    '600s',
    'flock',
    '--close',
    '/tmp/yaks-throughput-bench.lock',
  ])
  equal(measurement('pages', 70_000, 0)?.[2], '60s')
})

for (let verdict of ['unconfirmed', 'inconclusive'] as const) {
  test(`scheduled paired ${verdict} retains measurement uncertainty without a false scheduling failure`, async () => {
    let reports: string[] = [], banked = false
    let state: State = { good: {} }
    equal(
      await watch(['s'], state, {
        check: () => Promise.resolve({ verdict }),
        since: () => Promise.resolve([]),
        bank: () => {
          banked = true
          return Promise.resolve()
        },
        report: (_error, suite) => {
          reports.push(suite)
          return Promise.resolve()
        },
      }, { deadline: WINDOW, now: () => 0 }),
      { s: verdict },
    )
    equal(reports, [])
    equal(banked, false)
    equal(state.good, {})
  })
}
