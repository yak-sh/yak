/** CPU consumed by managed workers while people wait for them. Reads systemd
 * and cgroup accounting only; owns no managed process and sends no signals. */
import type { CollectedSuite } from '@yaks/benchmark'

let command = async (...args: string[]) => {
  let out = await new Deno.Command('systemctl', {
    args: ['--user', ...args],
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr))
  return new TextDecoder().decode(out.stdout).trim()
}
let workers = async () => {
  let units = (await command(
    'list-units',
    '--state=active',
    '--plain',
    '--no-legend',
    'yak-work@*.service',
  ))
    .split('\n').map((line) => line.trim().split(/\s+/)[0]).filter(Boolean)
  if (!units.length) throw new Error('No active managed worker to measure')
  return (await Promise.all(
    units.map((unit) => command('show', unit, '-p', 'ControlGroup', '--value')),
  ))
    .filter(Boolean).sort()
}
/** Total cgroup usage includes worker threads and child processes. */
export let usage = (stat: string): number => {
  let value = /^usage_usec (\d+)$/m.exec(stat)
  if (!value) throw new Error('No cgroup CPU accounting')
  return Number(value[1])
}
let total = async (groups: string[]) =>
  (await Promise.all(
    groups.map(async (group) =>
      usage(await Deno.readTextFile(`/sys/fs/cgroup${group}/cpu.stat`))
    ),
  )).reduce((a, b) => a + b, 0)
export let suite = (args: string[] = []): CollectedSuite => {
  if (args.length) throw new Error('worker-health takes no arguments')
  return {
    name: 'worker-health',
    metric: 'median-of-round-medians',
    workload: 'v2/active-systemd-worker-cgroups/1000ms/cpu-us-per-second',
    benches: [{ name: 'workers/cpu', unit: 'cpu-us/s' }],
    collect: async () => {
      let groups = await workers()
      if (!groups.length) throw new Error('Active worker has no ControlGroup')
      let before = await total(groups), start = performance.now()
      await new Promise((resolve) => setTimeout(resolve, 1000))
      let after = await total(groups), elapsed = performance.now() - start
      if (JSON.stringify(groups) != JSON.stringify(await workers())) {
        throw new Error(
          'Workers changed during CPU measurement; retry after restart',
        )
      }
      return { 'workers/cpu': (after - before) * 1000 / elapsed }
    },
  }
}
