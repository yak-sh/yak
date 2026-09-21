/** Defect receipts are not transcript entries: recording one must not wake a
 * model. An exception a process catches is an `exception` entity in the graph
 * where it matters — and where there is no graph to take it, or the graph is
 * the thing that broke, it is stderr. There is no second journal.
 */
import type { Bundle, Graph } from '@yaks/graph'

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
  let sinks: ((row: Bundle) => unknown)[] = []
  let warn = opts.warn ?? ((text: string) => console.error(text))
  let redact = (text: string) => {
    for (let secret of opts.secrets ?? []) {
      if (secret.length >= 8) text = text.split(secret).join('[redacted]')
    }
    return text.replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [redacted]')
      .replace(/\bsk-[a-zA-Z0-9_-]{12,}/g, '[redacted]')
  }
  let report = (error: unknown, context: FailureContext) => {
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
      body,
    }
    let save = sinks.at(-1)
    // Nowhere to write it is not nowhere to say it: the terminal is the floor.
    if (!save) return warn(JSON.stringify(record))
    let job = Promise.resolve().then(() =>
      save({
        entity: { eid: id },
        exception: {},
        content: { body: JSON.stringify(record, null, 2) },
      })
    ).then(() => {}, (failure) => {
      // Never recursively try to write a database failure to that database.
      warn(
        'Exception graph write failed: ' + redact(describeFailure(failure)) +
          '\nOriginal exception: ' + body,
      )
    })
    pending.add(job)
    void job.finally(() => pending.delete(job))
  }
  return {
    report,
    attach: (g: Pick<Graph, 'apply'>) => {
      let save = (row: Bundle) => g.apply([row], { trusted: true })
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
      if (pending.size) warn('Exception graph writes still pending')
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
