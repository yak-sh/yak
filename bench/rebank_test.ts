import type { Run } from '@yaks/benchmark'
import { equal, test, throws } from '@yaks/testing'
import { bank } from './rebank.ts'

let reading = (cpu: number, name = 'work'): Run => ({
  version: 1,
  suite: 's',
  metric: 'round-medians/cpu',
  workload: 1,
  at: '',
  commit: 'revision',
  runtime: 'runtime',
  cpu: 'machine',
  load: [],
  busy: 1,
  rounds: 1,
  tolerance: null,
  verdict: 'measured',
  regressions: [],
  benches: [{
    name,
    unit: 'ms',
    better: 'lower',
    samples: [{ value: 1000, cpu, round: 0 }],
    rounds: [{ index: 0, median: cpu, cpu, spans: null }],
    median: cpu,
    spread: 0,
    spans: null,
  }],
})

test('CPU rebanking preserves the reference when current code is slower', () => {
  let baseline = bank({
    verdict: 'slower',
    slower: ['work'],
    comparisons: [],
    reference: 'banked-revision',
    before: reading(100),
    current: reading(150),
    after: reading(100),
  })
  equal(baseline.benches[0].median, 100)
  equal(baseline.reference, 'banked-revision')
})

test('CPU rebanking cannot convert an unmeasured reference', async () => {
  let before = reading(100)
  delete before.benches[0].samples[0].cpu
  await throws(() =>
    bank({
      verdict: 'same',
      slower: [],
      comparisons: [],
      reference: 'banked-revision',
      before,
      after: reading(100),
    })
  )
})

test('CPU rebanking retains each workload reference in a mixed bank', () => {
  let group = (reference: string, name: string, cpu: number) => ({
    verdict: 'same' as const,
    slower: [],
    comparisons: [],
    reference,
    before: reading(cpu, name),
    current: reading(cpu + 1, name),
    after: reading(cpu, name),
  })
  let groups = [group('old', 'read', 100), group('new', 'write', 200)]
  let baseline = bank({
    verdict: 'same',
    slower: [],
    comparisons: [],
    groups,
    current: {
      ...reading(1),
      benches: groups.flatMap((g) => g.current.benches),
    },
  })
  equal(baseline.reference, undefined)
  equal(
    baseline.benches.map((b) => [b.name, b.median, b.reference]),
    [['read', 100, 'old'], ['write', 200, 'new']],
  )
})
