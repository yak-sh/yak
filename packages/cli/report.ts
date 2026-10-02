// Box hosts report to a file spool, without depending on the tracker graph's
// health. Existing console telemetry stays alongside it during the transition.

import type { Actor } from '@yaks/graph'
import { caught, type Context, spool } from '@yaks/tracker/report'
import { files } from '@yaks/tracker/file'
import type { Config } from './config.ts'

export let revision = async (): Promise<string | undefined> => {
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
  commit?: string,
): (error: unknown, context?: Partial<Context>) => Promise<void> => {
  let sink = config.tracker
    ? spool(files(config.tracker.spool).append)
    : undefined
  return async (error, context = {}) => {
    try {
      console.error('box failed —', error)
    } catch { /* telemetry cannot break the caller */ }
    if (sink) {
      await caught(error, {
        sink,
        actor,
        commit: config.tracker?.commit ?? commit,
        environment: 'production',
        ...context,
      })
    }
  }
}
