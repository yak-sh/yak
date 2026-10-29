#!/usr/bin/env -S deno run -A
/** Repository entrypoint for named benchmark suites and timed commands. */
import { type Options, Regressed, run } from '@yaks/benchmark'
import { throughput } from './throughput.ts'
import { command } from './suite.ts'

export let main = async (args = Deno.args): Promise<number> => {
  let [name = 'throughput', action = 'run', ...rest] = args
  if (name == 'command') return await command(args.slice(1))
  if (['run', 'check', 'ratchet', 'accept'].includes(name)) {
    action = name
    name = args[1] ?? 'throughput'
    rest = args.slice(2)
    if (rest[0] == '--') rest = rest.slice(1)
  }
  if (action == '--') {
    rest = args.slice(2)
    action = 'run'
  }
  let registeredBaseline: string | undefined
  let reference = rest.find((a) => a.startsWith('--baseline='))?.slice(
    '--baseline='.length,
  )
  rest = rest.filter((a) => !a.startsWith('--baseline='))
  let output = rest.find((a) => a.startsWith('--output='))?.slice(
    '--output='.length,
  )
  rest = rest.filter((a) => !a.startsWith('--output='))
  if (name == 'box') {
    if (!['run', 'check', 'accept', 'ratchet'].includes(action)) {
      throw new Error(`Unknown action: ${action}`)
    }
    return await (await import('./box.ts')).main(action, rest)
  }
  if (name == 'app-deploy') {
    if (action == 'time') {
      if (rest.length) throw new Error('app-deploy time takes no arguments')
      await (await import('../bin/app-deploy-time.ts')).main()
      return 0
    }
    if (!['run', 'check', 'accept', 'ratchet'].includes(action)) {
      throw new Error(`Unknown action: ${action}`)
    }
    let suite = await import('./app-deploy.ts')
    // App deploys use their recorded observations, one round each.
    let current = await suite.run({
      ...options(name, action, 1, 0),
      ...(reference || registeredBaseline
        ? { baseline: reference ?? registeredBaseline }
        : {}),
      ...(output ? { output } : {}),
    })
    console.log(`${name}: ${current?.verdict ?? 'no data (bootstrap)'}`)
    return 0
  }
  if (name == 'worker-health') {
    let observation = await import('./worker-health.ts')
    let current = await observation.run({
      ...options(name, action, 1),
      output: output ?? `bench/${name}.results.json`,
    }, observation.suite(rest))
    for (let b of current.benches) {
      console.log(`${b.name}: ${b.median} ${b.unit}`)
    }
    console.log(`${name}: live observation`)
    return 0
  }
  // The monitor already owns the box-wide flock before starting its timeout.
  let locked = rest.includes('--lock-held')
  rest = rest.filter((a) => a != '--lock-held')
  // The runner's own flags; everything else reaches the suite. A check and an
  // acceptance take three runs, so a check measures what banking measured.
  // `--slower` banks every bench as measured, `--slower=close,open` only those.
  let named = rest.find((a) => a.startsWith('--slower='))
  let slower = named
    ? named.slice('--slower='.length).split(',')
    : rest.includes('--slower')
  let runs = Number(
    rest.find((a) => a.startsWith('--runs='))?.slice('--runs='.length) ??
      (action == 'run' ? 1 : 3),
  )
  rest = rest.filter((a) =>
    a != '--slower' && !a.startsWith('--slower=') && !a.startsWith('--runs=')
  )
  let recording = name == 'throughput' && rest.includes('--recording')
  let definition
  let rounds = 3, floor = FLOOR
  if (name == 'throughput') {
    definition = throughput({
      recording,
      filter: recording
        ? rest.find((a) => a.startsWith('--filter='))?.slice('--filter='.length)
        : undefined,
    })
    rounds = 7
  } else {
    let { standalone } = await import('./standalone.ts')
    if (name == 'list') {
      console.log(
        [
          'throughput',
          'app-deploy',
          'worker-health',
          'box',
          ...standalone.map((b) => b.suite().name),
        ].join('\n'),
      )
      return 0
    }
    let entry = standalone.find((b) => b.suite().name == name)
    if (!entry) throw new Error(`Unknown suite: ${name}`)
    definition = entry.suite(rest)
    registeredBaseline = entry.baseline
    floor = entry.floor ?? FLOOR
  }
  let current = await run(definition, {
    ...options(name, action, rounds, floor),
    runs,
    ...(reference || registeredBaseline
      ? { baseline: reference ?? registeredBaseline }
      : {}),
    slower,
    coverage: recording ? 'subset' : 'exact',
    output: output ??
      (recording
        ? 'bench/apply-recording.results.json'
        : `bench/${name}.results.json`),
    lock: locked ? undefined : '/tmp/yaks-throughput-bench.lock',
  })
  for (let b of current.benches) console.log(`${b.name}: ${b.median} ${b.unit}`)
  console.log(
    `${name}: ${current.verdict}; box busy ${
      current.busy == null ? 'unknown' : `${Math.round(current.busy * 100)}%`
    }`,
  )
  return 0
}
/** The least slack acceptance banks. Above it, each bench banks the noise its
 * runs measured (@yaks/benchmark `baseline`). */
export let FLOOR = 0

let options = (
  name: string,
  action: string,
  rounds: number,
  floor = FLOOR,
): Options => {
  let mode = action == 'ratchet' ? 'accept' : action
  if (!['run', 'check', 'accept'].includes(mode)) {
    throw new Error(`Unknown action: ${action}`)
  }
  return {
    mode: mode as Options['mode'],
    figure: 'cpu',
    rounds,
    output: `bench/${name}.results.json`,
    baseline: `bench/${name}.baseline.json`,
    tolerance: mode == 'accept' ? floor : undefined,
  }
}
if (import.meta.main) {
  try {
    Deno.exit(await main())
  } catch (e) {
    if (e instanceof Regressed) {
      for (let b of e.result.regressions) {
        console.error(
          `REGRESSION ${b.name}: ${b.baseline} → ${b.current} ${b.unit}, ` +
            `over its limit of ${b.limit}`,
        )
      }
    }
    console.error(e instanceof Error ? e.message : e)
    Deno.exit(1)
  }
}
