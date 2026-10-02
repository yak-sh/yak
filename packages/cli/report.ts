// Box hosts report to a file spool, without depending on the tracker graph's
// health. Existing console telemetry stays alongside it during the transition.

import type { Actor } from '@yaks/graph'
import { caught, type Context, spool } from '@yaks/tracker/report'
import { files } from '@yaks/tracker/file'
import type { Config } from './config.ts'
import { type SentryEvent, sentryReporter } from '@yaks/tracker/sentry'
import { reveal } from '@yaks/secrets'
import { vaultOf } from './vault.ts'

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
  send?: (event: SentryEvent) => Promise<void>,
): (error: unknown, context?: Partial<Context>) => Promise<void> => {
  let sink = config.tracker
    ? spool(files(config.tracker.spool).append)
    : undefined
  // Probe/in-memory hosts without a tracker never call production telemetry.
  // The configured box already has SENTRY_DSN in its vault. Read at use time,
  // rather than caching an absent credential at startup.
  let vault = config.tracker && config.db ? vaultOf(config.db) : undefined
  let sentry = send ?? (vault
    ? sentryReporter({
      token: () => Promise.resolve(reveal(vault, 'sentry')),
      dsn: () => Promise.resolve(reveal(vault, 'SENTRY_DSN')),
    })
    : undefined)
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
    if (sentry) {
      try {
        await sentry({
          exception: {
            values: [{
              type: error instanceof Error ? error.name : 'Error',
              value: error instanceof Error ? error.message : String(error),
            }],
          },
          tags: { ...context.tags, ...context.during },
          extra: { commit, actor },
        })
      } catch (delivery) {
        // Keep telemetry failure out of the watched graph; never recurse into
        // Sentry to report Sentry, or lose the original durable spool record.
        console.error('Sentry report failed —', delivery)
        if (sink) {
          await caught(delivery, {
            sink,
            actor,
            commit,
            environment: 'production',
            tags: { step: 'sentry-report' },
          })
        }
      }
    }
  }
}
