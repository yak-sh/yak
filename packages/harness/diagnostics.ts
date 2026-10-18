/** Diagnostics deliver scrubbed failures to the host's reporter without
 * writing transcript entries or local defect rows. With no reporter, or when
 * delivery fails, stderr keeps the failure. There is no second journal.
 */
import type { Host } from '@yaks/host'
import { cpuUsage } from 'node:process'

export type FailureContext = { phase: string; session?: string }
export let describeFailure = (error: unknown): string => {
  let seen = new Set<unknown>()
  let describe = (e: unknown): string => {
    if (seen.has(e)) return '[circular cause]'
    seen.add(e)
    if (!(e instanceof Error)) return String(e)
    return (e.stack || e.name + ': ' + e.message) +
      (e.cause === undefined ? '' : '\nCaused by: ' + describe(e.cause))
  }
  return describe(error)
}

export let createDiagnostics = (opts: {
  warn?: (text: string) => void
  secrets?: string[]
} = {}) => {
  let seen = new WeakSet<object>()
  let pending = new Set<Promise<void>>()
  let sinks: NonNullable<Host['report']>[] = []
  let warn = opts.warn ?? ((text: string) => console.error(text))
  let redact = (text: string) => {
    for (let secret of opts.secrets ?? []) {
      if (secret.length >= 8) text = text.split(secret).join('[redacted]')
    }
    return text.replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [redacted]')
      .replace(/\bsk-[a-zA-Z0-9_-]{12,}/g, '[redacted]')
  }
  // CPU counters cost no subprocess or graph read. This process-wide sample
  // is not a main-thread profile; its interval and pid let the tracker correlate
  // transport stalls with a busy worker (including event-loop starvation).
  let sampled = performance.now(), cpu = cpuUsage()
  let report = (error: unknown, context: FailureContext) => {
    let now = performance.now(), used = cpuUsage()
    let span = Math.max(0.001, now - sampled)
    let state = {
      cpu_sample_ms: Math.round(span),
      cpu_percent: Math.round(
        (used.user - cpu.user + used.system - cpu.system) / span / 10,
      ),
      cpu_user_ms: Math.round(used.user / 1000),
      cpu_system_ms: Math.round(used.system / 1000),
    }
    sampled = now
    cpu = used
    if (
      error !== null && (typeof error == 'object' || typeof error == 'function')
    ) {
      if (seen.has(error)) return
      seen.add(error)
    }
    let id = crypto.randomUUID()
    let body = redact(describeFailure(error))
    let record = {
      id,
      at: new Date().toISOString(),
      pid: Deno.pid,
      ...context,
      ...state,
      body,
    }
    let save = sinks.at(-1)
    // Nowhere to write it is not nowhere to say it: the terminal is the floor.
    if (!save) return warn(JSON.stringify(record))
    let thrown = new Error(
      redact(error instanceof Error ? error.message : String(error)),
    )
    thrown.name = error instanceof Error ? error.name : 'Error'
    thrown.stack = body
    let job = Promise.resolve().then(() =>
      save(thrown, {
        eid: id,
        at: record.at,
        tags: { phase: context.phase, pid: record.pid, ...state },
        ...(context.session ? { during: { session: context.session } } : {}),
      })
    ).then(() => {}, (failure) => {
      // A failed report cannot recursively report itself.
      warn(
        'Diagnostic delivery failed: ' + redact(describeFailure(failure)) +
          '\nOriginal exception: ' + body,
      )
    })
    pending.add(job)
    void job.finally(() => pending.delete(job))
  }
  return {
    report,
    attach: (save: NonNullable<Host['report']>) => {
      sinks.push(save)
      return () => {
        let at = sinks.indexOf(save)
        if (at >= 0) sinks.splice(at, 1)
      }
    },
    drain: async (timeout = 250) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        Promise.all([...pending]),
        new Promise<void>((done) => timer = setTimeout(done, timeout)),
      ])
      clearTimeout(timer)
      if (pending.size) warn('Diagnostic deliveries still pending')
    },
  }
}

let shared: ReturnType<typeof createDiagnostics> | undefined
export let diagnostics = () =>
  shared ??= createDiagnostics({
    secrets: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'].map((k) =>
      Deno.env.get(k) ?? ''
    ),
  })

/** Observe fatal runtime events, without preventDefault: runtime exit
 * semantics remain intact.
 */
export let uncaught = (
  reporter: Pick<ReturnType<typeof createDiagnostics>, 'report'>,
  target: EventTarget = globalThis,
  cleanup: () => void = () => {},
) => {
  let capture = (event: Event) => {
    let error = event.type == 'error'
      ? (event as ErrorEvent).error ?? (event as ErrorEvent).message
      : (event as PromiseRejectionEvent).reason
    reporter.report(error, { phase: event.type })
    try {
      cleanup()
    } catch (e) {
      reporter.report(e, { phase: 'terminal-cleanup' })
    }
  }
  target.addEventListener('error', capture)
  target.addEventListener('unhandledrejection', capture)
  return () => {
    target.removeEventListener('error', capture)
    target.removeEventListener('unhandledrejection', capture)
  }
}
