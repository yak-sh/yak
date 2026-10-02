import { sentryReporter } from '@yaks/tracker/sentry'
// A leased host service, so cleanup keeps running between restarts and only
// one worker over this graph maintains the machine's worktree root.
import { sleep } from '@yaks/effects'
import { dbOf, type Host } from '@yaks/cli/host'
import { reveal } from '@yaks/secrets'
import { diagnostics } from './diagnostics.ts'
import { diskEvent, diskMonitor, failureEvent } from './disk.ts'
import { tidy } from './maintenance.ts'
import { dbPath, worktrees } from './paths.ts'

/** Milliseconds between maintenance passes. */
export let EVERY = 5 * 60 * 1000

export type Options = { every?: number; threshold?: number }

/** Run independent checks on each pass, retrying a failure on the next pass.
 * Shutdown waits for the current pass and interrupts the wait immediately. */
export let maintaining = async (
  checks: (() => Promise<void>)[],
  report: (error: unknown) => void | Promise<void>,
  signal: AbortSignal,
  every: number = EVERY,
): Promise<void> => {
  do {
    for (let check of checks) await check().catch(report)
    if (signal.aborted) return
    await sleep(every, signal)
  } while (!signal.aborted)
}

/** Foreign graphs never maintain this machine; compare canonical database paths. */
export let live = async (path: string): Promise<boolean> => {
  if (path == ':memory:') return false
  let canonical = (p: string) => Deno.realPath(p).catch(() => p)
  return await canonical(path) == await canonical(dbPath())
}

export let service = async (
  host: Host,
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
): Promise<void> => {
  // A probe or another graph must never sweep the live root.
  if (!await live(dbOf(host.config))) return
  let detach = diagnostics().attach(host.graph)
  let sentry = sentryReporter({
    token: async () => await reveal(host.vault, 'sentry'),
    dsn: async () => await reveal(host.vault, 'SENTRY_DSN'),
  })
  let disk = diskMonitor({
    threshold: options.threshold,
    report: (alert) => sentry(diskEvent(alert)),
  })
  try {
    await maintaining(
      [disk, () => tidy(host.graph, worktrees())],
      async (error) => {
        diagnostics().report(error, { phase: 'disk-maintenance' })
        await sentry(failureEvent(error, 'disk-maintenance')).catch(
          (delivery) =>
            diagnostics().report(delivery, { phase: 'sentry-report' }),
        )
      },
      signal,
      options.every,
    )
  } finally {
    await diagnostics().drain()
    detach()
  }
}
