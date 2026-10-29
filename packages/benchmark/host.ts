/** The process boundary: host config and machine metadata are read for each
 * run, not when a bench is declared. Reporter factories receive this context;
 * the default factory is empty until a reporting provider is installed. */
import { cpus, loadavg } from 'node:os'
import type { Run } from './result.ts'

export type Host = {
  config: Record<string, unknown>
  /** Config-relative provider paths are resolved against this URL. */
  configURL: string | null
  commit: string | null
  runtime: string
  cpu: string
  load: readonly number[]
  /** The share of the box's CPUs in use over a second the bench rests; absent
   * or undefined where the box does not say. The runner samples it before
   * each round (`Run.busy`). */
  busy?: () => Promise<number | undefined>
}
type Immutable<T> = T extends object
  ? { readonly [K in keyof T]: Immutable<T[K]> }
  : T
export type ReportedRun = Immutable<Run>
export type Reporter = (run: ReportedRun) => void | Promise<void>
export type Reporters = (
  host: Host,
) => readonly Reporter[] | Promise<readonly Reporter[]>

let resolve: Reporters = () => []
/** Install the process's reporter factory. It reads the current host config
 * on every run; workload modules neither configure nor construct reporters. */
export let configure = (factory: Reporters): () => void => {
  let previous = resolve
  resolve = factory
  return () => {
    resolve = previous
  }
}
export let reporters = (host: Host): ReturnType<Reporters> => resolve(host)

export let host = async (): Promise<Host> => {
  let path = Deno.env.get('YAK_CONFIG')
  let required = !!path
  let home = Deno.env.get('HOME')
  path ??= home ? `${home}/.yak/yak.json` : undefined
  let config: Record<string, unknown> = {}
  let configURL: string | null = null
  if (path) {
    let url = new URL(path, `file://${Deno.cwd()}/`)
    try {
      let read: unknown = JSON.parse(await Deno.readTextFile(url))
      if (!read || typeof read != 'object' || Array.isArray(read)) {
        throw new Error('Host config must be a JSON object')
      }
      config = read as Record<string, unknown>
      configURL = url.href
    } catch (error) {
      if (required || !(error instanceof Deno.errors.NotFound)) throw error
    }
  }
  let commit: string | null = null
  try {
    let result = await new Deno.Command('git', {
      args: ['rev-parse', 'HEAD'],
      stdout: 'piped',
      stderr: 'null',
    }).output()
    if (result.success) commit = new TextDecoder().decode(result.stdout).trim()
  } catch { /* A workload can run outside a Git checkout. */ }
  return {
    config,
    configURL,
    commit,
    runtime: `Deno/${Deno.version.deno} ${Deno.build.target}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    load: loadavg(),
    busy: () => busy(),
  }
}

/** The CPU time the box has used in all, in microseconds, from its cgroup (a
 * container's own); undefined where the box does not say. */
let used = (): number | undefined => {
  try {
    let n = Deno.readTextFileSync('/sys/fs/cgroup/cpu.stat')
      .match(/^usage_usec (\d+)/m)
    return n ? Number(n[1]) : undefined
  } catch {
    return undefined
  }
}

/** The share of the box's CPUs in use over the next `ms` while the caller
 * waits: the other work on the box. It is use, not CPU pressure, because a
 * busy hyperthread slows the work on its sibling without making anything wait
 * for a CPU: two of four busy cost a CPU-bound bench about a tenth. */
export let busy = async (ms = 1000): Promise<number | undefined> => {
  let before = used(), start = performance.now()
  await new Promise((done) => setTimeout(done, ms))
  let after = used(), took = performance.now() - start
  return before === undefined || after === undefined
    ? undefined
    : (after - before) / (took * 1000 * navigator.hardwareConcurrency)
}

let rusage: ((who: number) => number) | null | undefined
/** The CPU time this process and its finished children have used, in ms:
 * every thread's, user and system, as getrusage(2) keeps it. Throws when
 * CPU accounting is unavailable. Two readings bracket the CPU a step took, which
 * other work on the box barely moves, where it stretches the step's wall
 * time. A child counts once it has exited and been waited for, so a step
 * whose work runs in a process that outlives it is not measured this way. */
export let cputime = (): number => {
  if (rusage === undefined) {
    try {
      if (Deno.build.os != 'linux') throw new Error('glibc layout only')
      let { symbols } = Deno.dlopen('libc.so.6', {
        getrusage: { parameters: ['i32', 'buffer'], result: 'i32' },
      })
      // struct rusage opens with ru_utime and ru_stime, two 64-bit timevals.
      let usage = new BigInt64Array(18)
      rusage = (who) => {
        symbols.getrusage(who, usage)
        return Number(usage[0] + usage[2]) * 1e3 +
          Number(usage[1] + usage[3]) / 1e3
      }
    } catch {
      rusage = null
    }
  }
  if (!rusage) throw new Error('CPU accounting is unavailable on this platform')
  return rusage(0) + rusage(-1)
}

/** How long the calling thread has waited for a CPU since it started, in ms:
 * the time other work took from it, as Linux keeps it (schedstat's run delay);
 * undefined where the platform does not say. Two readings bracket what load
 * added to a span of the thread's work, so wall time less their difference is
 * what the span would have taken on an idle box. */
export let waited = (): number | undefined => {
  try {
    let delay = Deno.readTextFileSync('/proc/thread-self/schedstat')
      .split(' ')[1]
    return delay ? Number(delay) / 1e6 : undefined
  } catch {
    return undefined
  }
}
