import { equal, test, throws } from '@yaks/testing'
import type { Baseline, Run } from '@yaks/benchmark'
import {
  bracket,
  collectGroups,
  type Collection,
  compare,
  type Judgement,
} from './paired.ts'

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

let collection = (name: string): Collection => ({
  suite: 'fixture',
  reference: 'older',
  revision: 'current',
  names: [name],
  rounds: 3,
  driver: 'source-digest',
  runtime: 'test',
  cpu: 'test',
  protocol: 'paired-cpu-1',
})
let observed = (at: Collection): Judgement => {
  let reading = (commit: string) => ({
    ...run([100, 110, 105]),
    metric: 'round-medians/cpu',
    commit,
    benches: run([100, 110, 105]).benches.map((b) => ({
      ...b,
      name: at.names[0],
      samples: b.samples.map((s) => ({ ...s, cpu: s.value })),
    })),
  })
  return {
    verdict: 'same',
    comparisons: [],
    slower: [],
    reference: at.reference,
    revision: at.revision,
    before: reading(at.reference),
    current: reading(at.revision),
    after: reading(at.reference),
  }
}

test('a later group failure checkpoints completed CPU observations and resumes only unfinished work', async () => {
  let plan = [collection('read'), collection('write')]
  let checkpoints: Judgement[] = []
  let failed = await collectGroups(plan, async (at) => {
    if (at.names[0] == 'write') throw Error('current probe failed')
    return observed(at)
  }, {
    checkpoint: async (evidence) => {
      checkpoints.push(structuredClone(evidence))
    },
  })
  equal(failed.verdict, 'failed')
  equal(failed.complete, false)
  equal(checkpoints.map((c) => c.groups?.length), [1, 1])
  equal(failed.groups?.[0].collection, plan[0])
  equal(failed.groups?.[0].before?.benches[0].samples.map((s) => s.cpu), [
    100,
    110,
    105,
  ])
  let measured: string[] = []
  let completed = await collectGroups(plan, async (at) => {
    measured.push(at.names[0])
    return observed(at)
  }, { resume: failed })
  equal(measured, ['write'])
  equal(completed.complete, true)
  equal(completed.error, undefined)
  equal(completed.current?.benches.map((b) => b.name), ['read', 'write'])
})

test('resuming refuses changed sources, product revisions, sampling, or incomplete CPU groups', async () => {
  let at = collection('read')
  let saved = await collectGroups([at], async (at) => observed(at))
  for (
    let changed of [
      { ...at, driver: 'different-source' },
      { ...at, revision: 'different-product' },
      { ...at, reference: 'different-reference' },
      { ...at, rounds: 4 },
    ]
  ) {
    let called = 0
    await collectGroups([changed], async (at) => {
      called++
      return observed(at)
    }, { resume: saved })
    equal(called, 1)
  }
  delete saved.groups![0].after
  let called = 0
  await collectGroups([at], async (at) => {
    called++
    return observed(at)
  }, { resume: saved })
  equal(called, 1)
})
