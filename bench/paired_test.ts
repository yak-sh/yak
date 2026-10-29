import { equal, test, throws } from '@yaks/testing'
import type { Baseline, Run } from '@yaks/benchmark'
import { bracket, compare } from './paired.ts'

// One sitting's round medians (wall), and their CPU times where given.
let run = (
  values: number[],
  { better = 'lower', cpu }: {
    better?: 'lower' | 'higher'
    cpu?: number[]
  } = {},
): Run => ({
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
  rounds: values.length,
  tolerance: 0,
  verdict: 'measured',
  regressions: [],
  benches: [{
    name: 'work',
    unit: 'ms',
    better,
    median: values[1],
    spread: 0,
    spans: null,
    samples: values.map((value, round) => ({ value, round })),
    rounds: values.map((median, index) => ({
      index,
      median,
      cpu: cpu ? cpu[index] : median,
      spans: null,
    })),
  }],
})
let banked = (tolerance: number) =>
  ({
    tolerance,
    benches: [{ name: 'work', unit: 'ms', better: 'lower', median: 1 }],
  }) as Baseline
let verdict = (
  before: Run,
  current: Run,
  after = before,
  base?: Baseline,
) => compare({ before, current, after }, base).verdict

let shared = [100, 130, 110, 125, 105, 120]
for (let pressure of [1, 4, 12]) {
  let at = (xs: number[]) => run(xs.map((x) => x * pressure))
  test(`a box ${pressure} times as busy slows both alike: the same code is the same, added work is slower`, () => {
    equal(verdict(at(shared), at(shared)), 'same')
    equal(verdict(at(shared), at(shared.map((n) => n * 2))), 'slower')
  })
}

test('a slowdown counts only past a tenth and the slack its baseline banked', () => {
  let times = (k: number) => run(shared.map((n) => n * k))
  equal(verdict(run(shared), times(1.05)), 'same')
  equal(verdict(run(shared), times(1.15)), 'slower')
  equal(verdict(run(shared), times(1.15), run(shared), banked(.2)), 'same')
  equal(verdict(run(shared), times(1.25), run(shared), banked(.2)), 'slower')
})

test('CPU time is judged in every round, so a wall-clock wobble is not a slowdown', () => {
  let cpu = [50, 51, 50, 52, 49, 50]
  let reference = run(shared, { cpu })
  let stretched = run(shared.map((n) => n * 1.5), { cpu })
  equal(verdict(reference, stretched), 'same')
  equal(
    compare({ before: reference, current: stretched, after: reference })
      .comparisons[0].figure,
    'cpu',
  )
  equal(
    verdict(reference, run(shared, { cpu: cpu.map((n) => n * 1.3) })),
    'slower',
  )
  equal(verdict(run(shared), stretched), 'same')
})

test('a moving reference is inconclusive rather than a code regression', () => {
  equal(
    verdict(
      run([1, 2, 3, 2, 1, 3]),
      run([10, 11, 12, 11, 10, 12]),
      run([10, 11, 12, 11, 10, 12]),
    ),
    'inconclusive',
  )
})

test('a bench whose reference drifted is not judged, and hides nothing beside it', () => {
  let both = (x: Run, y: number[]): Run => ({
    ...x,
    benches: [...x.benches, { ...run(y).benches[0], name: 'other' }],
  })
  let before = both(run(shared), [1, 2, 3, 2, 1, 3])
  let after = both(run(shared), [10, 11, 12, 11, 10, 12])
  let doubled = both(run(shared.map((n) => n * 2)), [5, 6, 5, 6, 5, 6])
  equal(
    [
      verdict(before, doubled, after),
      verdict(before, both(run(shared), [5, 6, 5, 6, 5, 6]), after),
    ],
    ['slower', 'inconclusive'],
  )
})

test('faster code is the same, and higher-is-better keeps its direction', () => {
  let tens = [10, 11, 12, 11, 10, 12], ones = [1, 2, 3, 2, 1, 3]
  equal(verdict(run(tens), run(ones)), 'same')
  equal(
    verdict(run(tens, { better: 'higher' }), run(ones, { better: 'higher' })),
    'slower',
  )
})

test('missing observations are inconclusive, and incomparable runs refuse', () => {
  equal(verdict(run([]), run([1, 2, 3])), 'inconclusive')
  throws(() =>
    compare({
      before: { ...run([1, 2, 3]), workload: 2 },
      current: run([1, 2, 3]),
      after: run([1, 2, 3]),
    })
  )
})

test('a busy box during the bracket is recorded, and still judged', () => {
  let busy = (r: Run) => ({ ...r, busy: .8 })
  equal(verdict(busy(run(shared)), busy(run(shared))), 'same')
  equal(
    verdict(busy(run(shared)), busy(run(shared.map((n) => n * 2)))),
    'slower',
  )
})

test('bracket orders reference/current/reference and closes on a failed adapter', async () => {
  let seen: string[] = []
  let close = () => (seen.push('closed'), Promise.resolve())
  equal(
    await bracket((v) => (seen.push(v), Promise.resolve(v)), close),
    { before: 'reference', current: 'current', after: 'reference' },
  )
  equal(seen, ['reference', 'current', 'reference', 'closed'])
  seen = []
  await throws(() =>
    bracket((v) => {
      seen.push(v)
      if (v == 'current') throw Error('missing API')
      return Promise.resolve(v)
    }, close), 'missing API')
  equal(seen, ['reference', 'current', 'closed'])
})

test('missing CPU readings are inconclusive without a wall-clock fallback', () => {
  let missing = run(shared)
  for (let round of missing.benches[0].rounds) delete round.cpu
  equal(verdict(run(shared), missing), 'inconclusive')
})
