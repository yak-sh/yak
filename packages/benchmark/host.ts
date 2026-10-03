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
  }
}
