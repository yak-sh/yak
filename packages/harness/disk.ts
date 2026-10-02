import type { SentryEvent } from '@yaks/tracker/sentry'
import { describeFailure } from './diagnostics.ts'

/** The root disk is shared by every session. Check it without writing to the
 * graph, so an alert can still leave when the graph's disk is full. */
export let FREE_FLOOR = 10 * 1024 ** 3
export type DiskAlert = { path: string; free: number; threshold: number }

/** POSIX df's available column is in KiB, regardless of the box's locale. */
export let available = (output: string): number => {
  let row = output.trim().split('\n').at(-1)?.trim().split(/\s+/)
  let value = row?.length == 6 ? Number(row[3]) : NaN
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('df did not report available disk space')
  }
  return value * 1024
}

export let rootFree = async (): Promise<number> => {
  let { success, stdout } = await new Deno.Command('df', {
    args: ['-Pk', '/'],
    env: { LC_ALL: 'C' },
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!success) throw new Error('df could not check root disk space')
  return available(new TextDecoder().decode(stdout))
}

/** One report per low-space spell. A failed delivery remains owed, and a
 * recovered disk arms the next report. The service owns when checks run. */
export let diskMonitor = (opts: {
  free?: () => Promise<number>
  report: (alert: DiskAlert) => Promise<void>
  threshold?: number
}) => {
  let threshold = opts.threshold ?? FREE_FLOOR
  let reported = false
  return async () => {
    let free = await (opts.free ?? rootFree)()
    if (!Number.isSafeInteger(free) || free < 0) {
      throw new Error('invalid available disk space')
    }
    if (free >= threshold) reported = false
    else if (!reported) {
      await opts.report({ path: '/', free, threshold })
      reported = true
    }
  }
}

export let diskEvent = (alert: DiskAlert): SentryEvent => ({
  exception: {
    values: [{
      type: 'LowDiskSpace',
      value: `Root disk has ${(alert.free / 1024 ** 3).toFixed(2)} GiB ` +
        `free, below ${alert.threshold / 1024 ** 3} GiB`,
    }],
  },
  fingerprint: ['yak-root-disk-space'],
  tags: { phase: 'disk-space', path: alert.path },
  extra: { free_bytes: alert.free, threshold_bytes: alert.threshold },
})

export let failureEvent = (error: unknown, phase: string): SentryEvent => ({
  exception: {
    values: [{
      type: error instanceof Error ? error.name : 'Error',
      value: describeFailure(error),
    }],
  },
  tags: { phase },
})
