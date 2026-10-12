// Box hosts report to a durable spool without opening the tracker graph. The
// tracker service owns admission, remote delivery and retry.

import type { Actor, Comp } from '@yaks/graph'
import { caught, type Context, spool } from '@yaks/tracker/report'
import { files } from '@yaks/tracker/file'
import type { Config } from './config.ts'
import { runtimeRoot, runtimeStack } from './runtime.ts'

export let revision = async (): Promise<string | undefined> => {
  let pinned = runtimeRoot() ? Deno.env.get('YAK_RUNTIME_COMMIT') : undefined
  if (pinned) return pinned
  if (!import.meta.url.startsWith('file:')) return undefined
  try {
    let result = await new Deno.Command('git', {
      args: ['rev-parse', 'HEAD'],
      cwd: new URL('../../', import.meta.url),
      stdout: 'piped',
      stderr: 'null',
    }).output()
    return result.code == 0
      ? new TextDecoder().decode(result.stdout).trim()
      : undefined
  } catch {
    return undefined
  }
}

/// command(['serve', '--no-duties']) -> 'yak serve'
/// command(['graph', 'query', '.bug .order=-bug.hits']) -> 'yak graph query'
/// command(['memory', 'save', '@/tmp/body.md', '--id', 'M-1']) -> 'yak memory save'
/// command([]) -> 'yak'
/** The command a process runs, as its leading words: never an argument's
 * value, which may be anything a person typed. */
export let command = (argv: readonly string[]): string => {
  let lead = argv.slice(0, 2), stop = lead.findIndex((w) => !WORD.test(w))
  return ['yak', ...lead.slice(0, stop < 0 ? 2 : stop)].join(' ')
}
let WORD = /^[a-z][a-z-]*$/

let argv = (): string[] => {
  try {
    return Deno.args
  } catch {
    return []
  }
}

export let reporter = (
  config: Config,
  actor?: Actor,
  commit?: string | Promise<string | undefined>,
  roles: readonly string[] = [],
): {
  (error: unknown, context?: Partial<Context>): Promise<void>
  close: () => Promise<void>
} => {
  let file = config.tracker
    ? spool(files(config.tracker.spool).append)
    : undefined
  let pending = new Set<Promise<void>>()
  let report = async (error: unknown, context: Partial<Context> = {}) => {
    try {
      console.error('box failed —', error)
    } catch { /* telemetry cannot break the caller */ }
    if (!file) return
    let at = await commit
    await caught(error, {
      actor,
      commit: config.tracker?.commit ?? at,
      environment: 'production',
      ...context,
      tags: {
        source: 'box',
        command: command(argv()),
        ...roles.length ? { roles: roles.join(',') } : {},
        ...context.tags,
      },
      sink: (rows) =>
        file(rows.map((row) => {
          let exception = row.exception as Comp | undefined
          return typeof exception?.stack == 'string'
            ? {
              ...row,
              exception: { ...exception, stack: runtimeStack(exception.stack) },
            }
            : row
        })),
    })
  }
  return Object.assign((error: unknown, context?: Partial<Context>) => {
    let delivery = report(error, context)
    pending.add(delivery)
    void delivery.then(() => pending.delete(delivery))
    return delivery
  }, {
    close: async () => {
      await Promise.all(pending)
    },
  })
}
