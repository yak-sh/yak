import { equal, test, throws } from '@yaks/testing'
import type { Run } from '@yaks/benchmark'
import { bracket, compare, sample } from './paired.ts'

let run = (values: number[], better: 'lower' | 'higher' = 'lower'): Run => ({
  version: 1,
  suite: 'fixture',
  metric: 'wall-ms',
  workload: 1,
  at: '',
  commit: null,
  runtime: 'test',
  cpu: 'test',
  load: [],
  busy: null,
  rounds: 3,
  tolerance: 0,
  verdict: 'regressed',
  regressions: [],
  benches: [{
    name: 'work',
    unit: 'ms',
    better,
    median: values[1],
    spread: 0,
    spans: null,
    samples: values.map((value, round) => ({ value, round })),
    rounds: values.map((median, index) => ({ index, median, spans: null })),
  }],
})

equal(
  compare({
    before: run([10, 11, 12]),
    current: run([10, 11, 12]),
    after: run([10, 11, 12]),
  }).verdict,
  'unconfirmed',
)

for (let pressure of [1, 4, 12]) {
  let values = (xs: number[]) => run(xs.map((x) => x * pressure))
  let before = values([10, 11, 12]), after = values([10, 11, 12])
  test(`shared contention ${pressure} leaves equivalent code unconfirmed and added work detected`, () => {
    equal(
      compare({ before, current: values([10, 11, 12]), after }).verdict,
      'unconfirmed',
    )
    equal(compare({ before, current: values([20, 21, 22]), after }).slower, [
      'work',
    ])
    equal(
      compare({ before, current: values([20, 21, 22]), after }).verdict,
      'changed',
    )
  })
}
test('a moving reference is inconclusive rather than a code regression', () => {
  equal(
    compare({
      before: run([1, 2, 3]),
      current: run([10, 11, 12]),
      after: run([10, 11, 12]),
    }).verdict,
    'inconclusive',
  )
})
test('a faster current code and reversed throughput retain direction', () => {
  equal(
    compare({
      before: run([10, 11, 12]),
      current: run([1, 2, 3]),
      after: run([10, 11, 12]),
    }).verdict,
    'unconfirmed',
  )
  equal(
    compare({
      before: run([10, 11, 12], 'higher'),
      current: run([1, 2, 3], 'higher'),
      after: run([10, 11, 12], 'higher'),
    }).verdict,
    'changed',
  )
})
test('incomparable or missing paired observations never establish equivalence', () => {
  equal(
    compare({ before: run([]), current: run([1, 2, 3]), after: run([1, 2, 3]) })
      .verdict,
    'inconclusive',
  )
  throws(() =>
    compare({
      before: { ...run([1, 2, 3]), workload: 2 },
      current: run([1, 2, 3]),
      after: run([1, 2, 3]),
    })
  )
})

test('overlapping outliers do not hide reference drift', () => {
  equal(
    compare({
      before: run([1, 2, 100]),
      current: run([110, 111, 112]),
      after: run([90, 100, 101]),
    }).verdict,
    'inconclusive',
  )
})

test('bracket orders reference/current/reference and closes on a failed adapter', async () => {
  let seen: string[] = []
  equal(
    await bracket((v) => {
      seen.push(v)
      return Promise.resolve(v)
    }, () => {
      seen.push('closed')
      return Promise.resolve()
    }),
    { before: 'reference', current: 'current', after: 'reference' },
  )
  equal(seen, ['reference', 'current', 'reference', 'closed'])
  seen = []
  await throws(() =>
    bracket((v) => {
      seen.push(v)
      if (v == 'current') throw Error('missing API')
      return Promise.resolve(v)
    }, () => {
      seen.push('closed')
      return Promise.resolve()
    }), 'missing API')
  equal(seen, ['reference', 'current', 'closed'])
})

test('interleaved small slowdowns survive wide drift shared by both revisions', () => {
  let shared = [100, 130, 110, 125, 105, 120]
  equal(
    compare({
      before: run(shared),
      current: run(shared.map((n) => n * 1.05)),
      after: run(shared),
    }).verdict,
    'changed',
  )
  equal(
    compare({ before: run(shared), current: run(shared), after: run(shared) })
      .verdict,
    'unconfirmed',
  )
})

test('load observed during paired probes cannot confirm code differences', () => {
  equal(
    compare({
      before: run([10, 11, 12]),
      current: { ...run([20, 21, 22]), busy: .8 },
      after: run([10, 11, 12]),
    }).verdict,
    'loaded',
  )
})

test('terminal draft sittings keep a millisecond wobble unconfirmed', async () => {
  let sitting = async (values: number[]) => {
    let collectors: Record<string, string> = {
      'bench/standalone-worker.ts bench/terminal-interactions.ts': JSON
        .stringify({
          'tui/comment-draft-save': values.map((value) => ({ value })),
        }),
    }
    let samples = await sample(
      'terminal-interactions',
      (args) => Promise.resolve(collectors[args.join(' ')]),
    )
    equal(samples['tui/comment-draft-save'], values.map((value) => ({ value })))
    return run(values)
  }
  let before = await sitting([498, 501, 499, 502, 497, 500])
  let after = await sitting([499, 500, 498, 503, 498, 501])
  equal(
    compare({
      before,
      current: await sitting([499, 502, 500, 503, 498, 501]),
      after,
    }).verdict,
    'unconfirmed',
  )
  equal(
    compare({
      before,
      current: await sitting([510, 511, 510, 512, 509, 510]),
      after,
    }).verdict,
    'changed',
  )
})

test('paired probes read the last completed result amid diagnostic output', async () => {
  let values = { work: [{ value: 490 }] }
  equal(
    await sample('platform-waits', () =>
      Promise.resolve(
        'diagnostic\nPLATFORM_WAITS_RESULT={}\n' +
          `PLATFORM_WAITS_RESULT=${JSON.stringify(values)}\n`,
      )),
    values,
  )
  await throws(
    () => sample('inbox-content', () => Promise.resolve('not ready')),
    'Paired collector returned no measurements',
  )
})
