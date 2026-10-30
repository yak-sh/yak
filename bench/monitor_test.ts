/** What the bench monitor reports for each sequence of checks a suite can give
 * it. */
import type { Run } from '@yaks/benchmark'
import { equal, test } from '@yaks/testing'
import { assessed, judged, type Outcome, watch } from './monitor.ts'
import type { Judgement } from './paired.ts'

let run = (verdict: Run['verdict'], busy: number | null = null): Run => ({
  version: 1,
  suite: 's',
  metric: 'm',
  workload: 1,
  at: 'at-c2',
  commit: 'c2',
  runtime: 'r',
  cpu: 'c',
  load: [1, 1, 1],
  busy,
  rounds: 1,
  benches: [],
  tolerance: 0,
  verdict,
  regressions: [],
})
let outcome = (v: Outcome['verdict']): Outcome =>
  v == 'failed' ? { verdict: v, error: 'did not paint' } : v == 'regressed'
    ? {
      verdict: v,
      run: {
        ...run(v),
        regressions: [{
          name: 'task/warm (CPU)',
          unit: 'ms',
          baseline: 1000,
          limit: 1000,
          current: 1500,
          change: .5,
        }],
      },
      reference: 'c1',
      evidence: ['evidence: e.json'],
    }
    : v == 'passed' || v == 'measured'
    ? { verdict: v, run: run(v) }
    : { verdict: v }

// Each suite's checks in order; what was reported (title line) and what each
// suite came to.
let monitor = async (checks: Record<string, Outcome['verdict'][]>) => {
  let reports: string[] = [], asked: string[] = []
  let verdicts = await watch(Object.keys(checks), {
    check: (suite) => {
      let next = checks[suite].shift()
      if (!next) throw new Error('baseline missing')
      return Promise.resolve(outcome(next))
    },
    report: (error, suite, kind) => {
      reports.push(`${kind} ${suite}: ${error.message.split('\n')[0]}`)
      return Promise.resolve()
    },
    since: (from) => {
      asked.push(from)
      return Promise.resolve(['c2 the change'])
    },
  })
  return { reports, verdicts, asked }
}

test('a slowdown the side-by-side comparison found is reported with the commits since the code it beat', async () => {
  equal(await monitor({ s: ['regressed'] }), {
    reports: [
      'regressed s: s got slower: task/warm (CPU) 1,500 ms, 1,000 ms for the code before it',
    ],
    verdicts: { s: 'regressed' },
    asked: ['c1'],
  })
})

test('a failure is reported only when the check at once fails again', async () => {
  equal(await monitor({ s: ['failed', 'failed'], t: ['failed', 'passed'] }), {
    reports: ['failed s: s could not be measured: did not paint'],
    verdicts: { s: 'failed', t: 'passed' },
    asked: [],
  })
  equal(await monitor({ s: ['failed', 'loaded'] }), {
    reports: [],
    verdicts: { s: 'loaded' },
    asked: [],
  })
})

test('a thrown check is a failure and cannot hide the next suite', async () => {
  equal(await monitor({ broken: [], good: ['passed'] }), {
    reports: ['failed broken: broken could not be measured: baseline missing'],
    verdicts: { broken: 'failed', good: 'passed' },
    asked: [],
  })
})

test('a check that could tell nothing reports nothing', async () => {
  equal(
    await monitor({
      s: ['deferred'],
      t: ['loaded'],
      u: ['inconclusive'],
      v: ['measured'],
    }),
    {
      reports: [],
      verdicts: {
        s: 'deferred',
        t: 'loaded',
        u: 'inconclusive',
        v: 'measured',
      },
      asked: [],
    },
  )
})

test('a comparison names the benches it found slower and the time it judged', () => {
  let comparison = (name: string, figure: 'cpu', now: number) => ({
    name,
    unit: 'ms',
    figure,
    before: [],
    current: [],
    after: [],
    reference: 100,
    now,
  })
  let evidence: Judgement = {
    verdict: 'slower',
    slower: ['a', 'c'],
    comparisons: [
      comparison('a', 'cpu', 130),
      comparison('b', 'cpu', 101),
      comparison('c', 'cpu', 150),
    ],
    revision: 'c3',
    current: run('measured', .1),
  }
  let out = judged(run('regressed', .05), evidence)
  equal(
    [out.commit, out.busy, out.regressions.map((r) => [r.name, r.current])],
    ['c3', .1, [['a (CPU)', 130], ['c (CPU)', 150]]],
  )
})

test('mixed baseline regressions report each benchmark’s revision and its commits', async () => {
  let histories: string[] = [], message = ''
  let current = outcome('regressed') as Extract<
    Outcome,
    { verdict: 'regressed' }
  >
  current.reference = undefined
  current.run.regressions = ['old-a', 'old-b'].map((reference, i) => ({
    ...current.run.regressions[0],
    name: `work-${i}`,
    reference,
  }))
  await watch(['mixed'], {
    check: () => Promise.resolve(current),
    since: (reference) => {
      histories.push(reference)
      return Promise.resolve([`${reference} commits`])
    },
    report: (error) => {
      message = error.message
      return Promise.resolve()
    },
  })
  equal(histories, ['old-a', 'old-b'])
  equal(
    ['old-a', 'old-b'].every((reference) => message.includes(reference)),
    true,
  )
})

test('only complete paired evidence reports a screened slowdown', async () => {
  let screen = run('regressed')
  let evidence: Judgement = {
    verdict: 'slower',
    complete: true,
    slower: ['work'],
    comparisons: [{
      name: 'work',
      unit: 'ms',
      figure: 'cpu',
      before: [1, 1, 1, 1, 1, 1],
      current: [3, 3, 3, 3, 3, 3],
      after: [1, 1, 1, 1, 1, 1],
      reference: 1,
      now: 3,
    }],
  }
  let reports: string[] = []
  for (
    let [label, changed] of [
      ['complete', evidence],
      ['partial', {
        ...evidence,
        complete: false,
        error: 'Collection incomplete',
      }],
      ['legacy', { ...evidence, complete: undefined }],
      ['broken', { ...evidence, error: 'Missing observations' }],
    ] as const
  ) {
    await watch([label], {
      check: () => Promise.resolve(assessed(screen, changed, 'paired.json')),
      report: (_error, suite) => {
        reports.push(suite)
        return Promise.resolve()
      },
      since: () => Promise.resolve([]),
    })
  }
  equal(reports, ['complete'])
  equal(
    assessed(screen, { ...evidence, verdict: 'same', complete: false }, '')
      .verdict,
    'inconclusive',
  )
  equal(
    assessed(screen, { ...evidence, verdict: 'same' }, '').verdict,
    'passed',
  )
  equal(
    assessed(screen, { ...evidence, verdict: 'failed', complete: false }, '')
      .verdict,
    'failed',
  )
})
