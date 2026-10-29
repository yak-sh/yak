import { equal, test } from '@yaks/testing'
import type { Baseline, Host, Run } from '@yaks/benchmark'
import { combined, grouped, references } from './references.ts'
import type { Judgement } from './paired.ts'
import { throughput } from './throughput.ts'

let base = {
  reference: 'suite',
  benches: [{ name: 'a', reference: 'old-a' }, { name: 'b' }],
} as Baseline

test('each benchmark keeps its measured revision when a suite has mixed references', () => {
  let source = references(base, ['a', 'b', 'new'], 'history')
  equal(source, { a: 'old-a', b: 'suite', new: 'suite' })
  equal(grouped(source), [['old-a', ['a']], ['suite', ['b', 'new']]])
  equal(references(base, ['a', 'b'], 'history', { a: 'override' }), {
    a: 'override',
    b: 'suite',
  })
})

test('mixed comparison evidence retains each reference instead of inventing one suite revision', () => {
  let group = (name: string, reference: string): Judgement => {
    let run = { commit: reference, benches: [{ name }] } as Run
    return {
      verdict: 'same',
      slower: [],
      comparisons: [],
      reference,
      references: { [name]: reference },
      revision: 'current',
      before: run,
      current: { ...run, commit: 'current' },
      after: run,
    }
  }
  let out = combined([group('b', 'old-b'), group('a', 'old-a')], ['a', 'b'])
  equal(out.reference, undefined)
  equal(out.references, { b: 'old-b', a: 'old-a' })
  equal(out.before?.commit, null)
  equal(out.before?.benches.map((bench) => bench.name), ['a', 'b'])
  equal(out.groups?.map((group) => group.reference), ['old-b', 'old-a'])
})

test('a throughput reference group runs only its storage modes and pipeline workloads', async () => {
  let names = ['sqlite/memory/point', 'apply/ram/edit-alone-200']
  let modes: string[] = []
  let machine: Host = {
    config: {},
    configURL: null,
    commit: 'current',
    runtime: 'test',
    cpu: 'test',
    load: [],
  }
  let suite = throughput({
    names,
    host: () => Promise.resolve(machine),
    measure: (mode) => {
      modes.push(mode)
      return Promise.resolve({
        version: 1,
        runtime: 'test',
        cpu: 'test',
        benches: [{
          name: mode == 'pipeline' ? names[1] : names[0],
          results: [{ ok: { avg: 100, cpu: 50 } }],
        }],
      })
    },
    counts: () => Promise.resolve({}),
  })
  equal(suite.benches.map((bench) => bench.name).sort(), [...names].sort())
  let result = await suite.collect(0)
  equal(modes, ['memory', 'pipeline'])
  equal(Object.keys(result).sort(), [...names].sort())
  equal((result[names[1]] as { cpu: number }).cpu, .25)
})
