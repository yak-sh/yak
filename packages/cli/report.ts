// Box hosts report to a file spool, without depending on the tracker graph's
// health. Existing console telemetry stays alongside it during the transition.

import type { Actor } from '@yaks/graph'
import {
  caught,
  coalesce,
  type Context,
  fanout,
  spool,
} from '@yaks/tracker/report'
import { files } from '@yaks/tracker/file'
import type { Config } from './config.ts'
import { sentry, type SentryEvent, sentryReporter } from '@yaks/tracker/sentry'
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
  commit?: string | Promise<string | undefined>,
  send?: (event: SentryEvent) => Promise<void>,
): {
  (error: unknown, context?: Partial<Context>): Promise<void>
  close: () => Promise<void>
  failures: Record<string, number>
} => {
  let file = config.tracker
    ? spool(files(config.tracker.spool).append)
    : undefined
  // Probe/in-memory hosts without a tracker never call production telemetry.
  // The configured box already has SENTRY_DSN in its vault. Read at use time,
  // rather than caching an absent credential at startup.
  let vault = config.tracker && config.db ? vaultOf(config.db) : undefined
  let transport = send ?? (vault
    ? sentryReporter({
      token: () => Promise.resolve(reveal(vault, 'sentry')),
      dsn: () => Promise.resolve(reveal(vault, 'SENTRY_DSN')),
    })
    : undefined)
  let sinks = fanout({
    ...file ? { spool: file } : {},
    ...transport ? { sentry: sentry(transport) } : {},
  })
  let sink = coalesce(sinks)
  let pending = new Set<Promise<void>>()
  let report = async (error: unknown, context: Partial<Context> = {}) => {
    try {
      console.error('box failed —', error)
    } catch { /* telemetry cannot break the caller */ }
    if (!file && !transport) return
    let at = await commit
    await caught(error, {
      actor,
      commit: config.tracker?.commit ?? at,
      environment: 'production',
      ...context,
      sink,
    })
  }
  return Object.assign((error: unknown, context?: Partial<Context>) => {
    let delivery = report(error, context)
    pending.add(delivery)
    void delivery.then(() => pending.delete(delivery))
    return delivery
  }, {
    failures: sinks.failures,
    close: async () => {
      await Promise.all(pending)
      await sink.close()
    },
  })
}
