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
  if (name == 'deploy' || name == 'app-deploy') {
    if (action == 'time') {
      if (name == 'deploy') {
        return await (await import('../bin/deploy-time.ts')).main(rest)
      }
      if (rest.length) throw new Error('app-deploy time takes no arguments')
      await (await import('../bin/app-deploy-time.ts')).main()
      return 0
    }
    if (!['run', 'check', 'accept', 'ratchet'].includes(action)) {
      throw new Error(`Unknown action: ${action}`)
    }
    let suite = name == 'deploy'
      ? await import('./deploy.ts')
      : await import('./app-deploy.ts')
    let current = await suite.run(options(name, action, 1))
    console.log(`${name}: ${current?.verdict ?? 'no data (bootstrap)'}`)
    return 0
  }
  let definition
  let rounds = 3
  if (name == 'throughput') {
    definition = throughput()
    rounds = 7
  } else {
    let { standalone } = await import('./standalone.ts')
    if (name == 'list') {
      console.log(
        [
          'throughput',
          'deploy',
          'app-deploy',
          ...standalone.map((b) => b.suite().name),
        ].join('\n'),
      )
      return 0
    }
    let entry = standalone.find((b) => b.suite().name == name)
    if (!entry) throw new Error(`Unknown suite: ${name}`)
    definition = entry.suite(rest)
  }
  let current = await run(definition, {
    ...options(name, action, rounds),
    lock: '/tmp/yaks-throughput-bench.lock',
  })
  for (let b of current.benches) console.log(`${b.name}: ${b.median} ${b.unit}`)
  console.log(`${name}: ${current.verdict}; load ${current.load.join(', ')}`)
  return 0
}
let options = (name: string, action: string, rounds: number): Options => {
  let mode = action == 'ratchet' ? 'accept' : action
  if (!['run', 'check', 'accept'].includes(mode)) {
    throw new Error(`Unknown action: ${action}`)
  }
  return {
    mode: mode as Options['mode'],
    rounds,
    output: `bench/${name}.results.json`,
    baseline: `bench/${name}.baseline.json`,
    tolerance: mode == 'accept' ? name == 'throughput' ? .2 : .25 : undefined,
  }
}
if (import.meta.main) {
  try {
    Deno.exit(await main())
  } catch (e) {
    if (e instanceof Regressed) {
      for (let b of e.result.regressions) {
        console.error(
          `REGRESSION ${b.name}: ${b.baseline} → ${b.current} ${b.unit}`,
        )
      }
    }
    console.error(e instanceof Error ? e.message : e)
    Deno.exit(1)
  }
}
