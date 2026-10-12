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

export let reporter = (
  config: Config,
  actor?: Actor,
  commit?: string | Promise<string | undefined>,
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
      tags: { source: 'box', ...context.tags },
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
