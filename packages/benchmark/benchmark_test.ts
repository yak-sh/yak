/** Workload and runner behavior through their public interfaces. Fixtures keep
 * filesystem and host effects in memory so no throughput work runs as a test. */
import { equal, match, ok, test, throws } from '@yaks/testing'
import {
  baseline,
  type Bench,
  bench,
  compare,
  configure,
  type Files,
  type Host,
  Regressed,
  type ReportedRun,
  type Run,
  run,
  type Suite,
} from './mod.ts'
import { extract } from './deno.ts'
import { channel, during, peek } from '@yaks/trace'

let fixture = (
  benches: Bench[] = [{ name: 'work', unit: 'ms', sample: () => 100 }],
) => {
  let saved = new Map<string, string>()
  let files: Files = {
    read: (path) => {
      if (!saved.has(path)) return Promise.reject(new Error(`Missing ${path}`))
      return Promise.resolve(saved.get(path)!)
    },
    write: (path, value) => {
      saved.set(path, JSON.stringify(value))
      return Promise.resolve()
    },
  }
  let context: Host = {
    config: {},
    configURL: null,
    commit: 'abc',
    runtime: 'test',
    cpu: 'test',
    load: [1, 2, 3],
  }
  let suite: Suite = {
    name: 'suite',
    metric: 'median-of-round-medians',
    workload: 1,
    benches,
  }
  let options = {
    output: 'result',
    baseline: 'baseline',
    files,
    host: () => context,
  }
  return { saved, files, context, suite, options }
}

test('runs retain raw samples, round medians, counts and host metadata', async () => {
  let f = fixture([{
    name: 'work',
    unit: 'ms',
    sample: (round) =>
      [
        [1, 2, 3, 4, 5],
        [100],
        [50],
      ][round].map((value) => ({ value, counts: { operations: 2 } })),
  }])
  let result = await run(f.suite, f.options)
  equal(result.benches[0].median, 50)
  equal(result.benches[0].rounds.map((r) => r.median), [3, 100, 50])
  equal(
    result.benches[0].samples.map((
      s,
    ) => [s.round, s.value, s.counts?.operations]),
    [
      [0, 1, 2],
      [0, 2, 2],
      [0, 3, 2],
      [0, 4, 2],
      [0, 5, 2],
      [1, 100, 2],
      [2, 50, 2],
    ],
  )
  equal(result.benches[0].spans, null)
  match(JSON.parse(f.saved.get('result')!), {
    commit: 'abc',
    load: [1, 2, 3],
    rounds: 3,
    verdict: 'measured',
  })
})

test('host reporter factories resolve each run, after JSON, including regression', async () => {
  let f = fixture()
  let seen: [unknown, string][] = []
  let stop = configure((host) => [(result) => {
    equal(
      JSON.parse(f.saved.get('result')!),
      JSON.parse(JSON.stringify(result)),
    )
    seen.push([host.config.destination, result.verdict])
  }])
  try {
    f.context.config.destination = 'first'
    await run(f.suite, { ...f.options, mode: 'accept', tolerance: .2 })
    let accepted = f.saved.get('baseline')
    f.context.config.destination = 'second'
    f.suite.benches[0].sample = () => 130
    let error = await throws(
      () => run(f.suite, { ...f.options, mode: 'check' }),
      'exceeded tolerance',
    )
    let regression = ok(error instanceof Regressed ? error : null)
    equal(regression.result.regressions.map((r) => r.name), ['work'])
    equal(f.saved.get('baseline'), accepted)
    equal(seen, [['first', 'accepted'], ['second', 'regressed']])
  } finally {
    stop()
  }
})

test('baseline acceptance is explicit and check fails closed before collecting', async () => {
  let calls = 0
  let f = fixture([{
    name: 'work',
    unit: 'ms',
    sample: () => {
      calls++
      return 100
    },
  }])
  // Acceptance and validation need one sample; round aggregation is proved above.
  let options = { ...f.options, rounds: 1 }
  await throws(
    () => run(f.suite, { ...options, mode: 'check' }),
    'Missing baseline',
  )
  for (let bad of ['null', '{}', '{', '{"version":2}']) {
    f.saved.set('baseline', bad)
    await throws(() => run(f.suite, { ...options, mode: 'check' }))
  }
  equal(calls, 0)
  await throws(
    () => run(f.suite, { ...options, mode: 'accept' }),
    'Tolerance',
  )
  equal(calls, 0)
  await run(f.suite, { ...options, mode: 'accept', tolerance: .2 })
  let accepted = f.saved.get('baseline')
  f.suite.benches[0].sample = () => 120
  equal((await run(f.suite, { ...options, mode: 'check' })).verdict, 'passed')
  await run(f.suite, options)
  equal(f.saved.get('baseline'), accepted)
  for (let bad of [NaN, Infinity, -1]) {
    f.suite.benches[0].sample = () => bad
    await throws(
      () => run(f.suite, { ...options, mode: 'accept', tolerance: .2 }),
      'sample',
    )
    equal(f.saved.get('baseline'), accepted)
  }
})

test('ratchets reject incompatible comparisons and support both directions', async () => {
  let f = fixture()
  let current = await run(f.suite, f.options)
  let base = baseline(current, .2)
  for (
    let field of ['suite', 'metric', 'workload', 'runtime', 'cpu'] as const
  ) {
    await throws(
      () => compare(base, { ...current, [field]: 'different' }),
      `Incomparable ${field}`,
    )
  }
  for (
    let benches of [[], [...current.benches, current.benches[0]], [{
      ...current.benches[0],
      name: 'renamed',
    }]]
  ) {
    await throws(() => compare(base, { ...current, benches }))
  }
  await throws(
    () =>
      compare(base, {
        ...current,
        benches: [{ ...current.benches[0], unit: 'us' }],
      }),
    'unit/direction',
  )
  await throws(
    () =>
      compare(base, {
        ...current,
        benches: [{ ...current.benches[0], median: NaN }],
      }),
    'sample',
  )
  for (let better of ['lower', 'higher'] as const) {
    current.benches[0].better = better
    base = baseline(current, .2)
    current.benches[0].median = better == 'lower' ? 120 : 80
    equal(compare(base, current), [])
    current.benches[0].median = better == 'lower' ? 130 : 70
    equal(compare(base, current).map((r) => r.name), ['work'])
    current.benches[0].median = 100
  }
})

test('scoped observations compare banked work and retain other workloads on acceptance', async () => {
  let work = (name: string, cost = 100): Bench => ({
    name,
    unit: 'ms',
    sample: () => cost,
  })
  let f = fixture([work('production'), work('staging', 200)])
  await run(f.suite, { ...f.options, mode: 'accept', tolerance: .2 })
  let scoped = { ...f.options, coverage: 'subset' as const }
  let production = { ...f.suite, benches: [work('production', 90)] }
  await throws(
    () => run(production, { ...f.options, mode: 'check' }),
    'Benchmark set changed',
  )
  equal((await run(production, { ...scoped, mode: 'check' })).verdict, 'passed')
  await throws(
    () =>
      run({ ...production, benches: [work('production', 130)] }, {
        ...scoped,
        mode: 'check',
      }),
    'exceeded tolerance',
  )
  let newWork = { ...f.suite, benches: [work('development', 300)] }
  equal((await run(newWork, { ...scoped, mode: 'check' })).verdict, 'measured')
  await run(production, { ...scoped, mode: 'accept', tolerance: .2 })
  await run(newWork, { ...scoped, mode: 'accept', tolerance: .2 })
  equal(
    Object.fromEntries(
      JSON.parse(f.saved.get('baseline')!).benches.map((b: {
        name: string
        median: number
      }) => [b.name, b.median]),
    ),
    { production: 90, staging: 200, development: 300 },
  )
  equal((await run(newWork, { ...scoped, mode: 'check' })).verdict, 'passed')
  await throws(
    () => run({ ...newWork, workload: 2 }, { ...scoped, mode: 'check' }),
    'Incomparable workload',
  )
})

test('sample resolution rounds tolerance boundaries and must match the baseline', async () => {
  for (let better of ['lower', 'higher'] as const) {
    let cost = 2106
    let workload: Bench = {
      name: 'work',
      unit: 'ms',
      better,
      resolution: 1,
      sample: () => cost,
    }
    let f = fixture([workload])
    await run(f.suite, { ...f.options, mode: 'accept', tolerance: .25 })
    equal(JSON.parse(f.saved.get('baseline')!).benches[0].resolution, 1)
    cost = better == 'lower' ? 2633 : 1580
    equal(
      (await run(f.suite, { ...f.options, mode: 'check' })).verdict,
      'passed',
    )
    cost += better == 'lower' ? 1 : -1
    await throws(
      () => run(f.suite, { ...f.options, mode: 'check' }),
      'exceeded tolerance',
    )
    for (let resolution of [undefined, 2]) {
      workload.resolution = resolution
      await throws(
        () => run(f.suite, { ...f.options, mode: 'check' }),
        'resolution',
      )
    }
    for (let resolution of [0, -1, Infinity, NaN]) {
      workload.resolution = resolution
      await throws(
        () => run(f.suite, { ...f.options, mode: 'check' }),
        'resolution',
      )
    }
  }
  let f = fixture([{ name: 'work', unit: 'ms', sample: () => 2106 }])
  await run(f.suite, { ...f.options, mode: 'accept', tolerance: .25 })
  f.suite.benches[0].sample = () => 2633
  await throws(
    () => run(f.suite, { ...f.options, mode: 'check' }),
    'exceeded tolerance',
  )
})

test('timed benches sample sync and async work with untimed setup and cleanup', async () => {
  for (let async of [false, true]) {
    let calls: string[] = []
    let b = bench({
      name: 'work',
      unit: 'ns/bundle',
      iterations: 2,
      operations: 3,
      setup: ({ round, iteration }) => {
        calls.push(`setup ${round}/${iteration}`)
      },
      run: () => {
        calls.push('work')
        return async ? Promise.resolve() : undefined
      },
      teardown: () => {
        calls.push('cleanup')
      },
    })
    let f = fixture([b])
    let result = await run(f.suite, { ...f.options, rounds: 1 })
    equal(calls, [
      'setup 0/0',
      'work',
      'cleanup',
      'setup 0/1',
      'work',
      'cleanup',
    ])
    equal(result.benches[0].samples.length, 2)
    ok(
      result.benches[0].samples.every((s) =>
        s.value >= 0 && s.counts?.operations == 3
      ),
    )
    equal(result.benches[0].spans?.[0].kind, 'bench')
  }
  let cleaned = false
  let b = bench({
    name: 'failed',
    unit: 'ms',
    run: () => {
      throw new Error('work failed')
    },
    teardown: () => {
      cleaned = true
    },
  })
  await throws(() => b.sample(0), 'work failed')
  equal(cleaned, true)
})

test('recording keeps the target tree and selects the median round without rerunning work', async () => {
  let target = {}, other = {}, calls = 0
  let b = bench({
    name: 'traced',
    unit: 'ms',
    target,
    run: () => {
      calls++
      return during(
        peek(target)?.begin({ kind: 'apply', name: 'apply' }),
        () => {
          during(
            peek(other)?.begin({ kind: 'apply', name: 'interleaved' }),
            () => {},
          )
        },
      )
    },
  })
  let stop = channel(other).subscribe(() => {})
  try {
    let f = fixture([b])
    let result = await run(f.suite, f.options)
    equal(calls, 3)
    equal(result.benches[0].spans?.map((s) => s.name), ['apply'])
    let rounds = result.benches[0].rounds
    equal(
      result.benches[0].spans,
      [...rounds].sort((a, b) => a.median - b.median)[1].spans,
    )
  } finally {
    stop()
  }
})

test('shared collectors retain Deno provenance and refuse a changed workload set', async () => {
  let f = fixture()
  let report = {
    version: 1,
    runtime: 'test',
    cpu: 'test',
    benches: [{
      name: 'work',
      results: [{ ok: { avg: 100, min: 50, n: 10 } }],
    }],
  }
  let samples = extract(report, ['work'])
  let result = await run({ ...f.suite, collect: () => samples }, f.options)
  match(result.benches[0].samples[0], {
    value: 100,
    source: 'deno-average',
    details: { avg: 100, min: 50, n: 10 },
  })
  await throws(
    () => run({ ...f.suite, collect: () => ({ extra: 1 }) }, f.options),
    'set changed',
  )
  for (
    let benches of [[], [report.benches[0], report.benches[0]], [{
      name: 'work',
      results: [],
    }], [{ name: 'work', results: [{ failed: 'boom' }] }]]
  ) {
    await throws(() => extract({ ...report, benches }, ['work']))
  }
  for (let avg of [0, -1, NaN, Infinity]) {
    await throws(() =>
      extract({
        ...report,
        benches: [{ name: 'work', results: [{ ok: { avg } }] }],
      }, ['work'])
    )
  }
})

test('all reporters receive the saved result even when another reporter fails', async () => {
  let f = fixture()
  let seen: ReportedRun[] = []
  let log = console.error
  console.error = () => {}
  try {
    let result = await run(f.suite, {
      ...f.options,
      reporters: () => [() => {
        throw new Error('offline')
      }, (run) => {
        seen.push(run)
      }],
    })
    equal(seen, [JSON.parse(JSON.stringify(result))])
    ok(f.saved.has('result'))
  } finally {
    console.error = log
  }
})

test('reporters cannot change the ratchet verdict or another reporter’s samples', async () => {
  let f = fixture()
  await run(f.suite, { ...f.options, mode: 'accept', tolerance: .2 })
  f.suite.benches[0].sample = () => 130
  let seen: number[] = []
  let log = console.error
  console.error = () => {}
  try {
    let error = await throws(() =>
      run(f.suite, {
        ...f.options,
        mode: 'check',
        reporters: () => [
          (r) => {
            ;(r as Run).verdict = 'passed'
          },
          (r) => {
            ;(r as Run).benches[0].samples[0].value = 1
          },
          (r) => {
            seen.push(r.benches[0].samples[0].value)
          },
        ],
      })
    )
    ok(error instanceof Regressed)
    equal(seen, [130])
    equal(JSON.parse(f.saved.get('result')!).verdict, 'regressed')
    let result = await run(f.suite, {
      ...f.options,
      reporters: () => {
        throw new Error('factory offline')
      },
    })
    equal(result.verdict, 'measured')
    equal(JSON.parse(f.saved.get('result')!).verdict, 'measured')
  } finally {
    console.error = log
  }
})

test('path aliases and nonfinite workload versions cannot implicitly accept a baseline', async () => {
  let f = fixture()
  let calls = 0
  f.suite.benches[0].sample = () => {
    calls++
    return 1
  }
  for (let output of ['baseline', './baseline', 'folder/../baseline']) {
    await throws(() => run(f.suite, { ...f.options, output }), 'separate paths')
  }
  for (let version of [NaN, Infinity, -Infinity]) {
    await throws(
      () =>
        run({ ...f.suite, workload: version }, {
          ...f.options,
          mode: 'accept',
          tolerance: .2,
        }),
      'workload version',
    )
  }
  equal(calls, 0)
  equal(f.saved.size, 0)
})

test('a symlinked output directory cannot overwrite the baseline', async () => {
  let f = fixture()
  let directory = await Deno.makeTempDir({ prefix: 'benchmark-baseline-' })
  try {
    let options = {
      output: directory + '/result.json',
      baseline: directory + '/baseline.json',
      host: f.options.host,
    }
    await run(f.suite, { ...options, mode: 'accept', tolerance: .2 })
    let before = await Deno.readTextFile(options.baseline)
    await Deno.symlink(directory, directory + '/alias', { type: 'dir' })
    let calls = 0
    f.suite.benches[0].sample = () => {
      calls++
      return 100
    }
    await throws(() =>
      run(f.suite, {
        ...options,
        mode: 'check',
        output: directory + '/alias/baseline.json',
      }), 'separate paths')
    equal(calls, 0)
    equal(await Deno.readTextFile(options.baseline), before)
  } finally {
    await Deno.remove(directory, { recursive: true })
  }
})
