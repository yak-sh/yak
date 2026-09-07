// The incident is also the cooldown: thirty quiet minutes end an outage.
// Rows stay readable by `yak errors` after the outage ends.
export let COOLDOWN = 30 * 60 * 1000

export type Sample = {
  name: string
  message: string
  stack: string
  entrypoint: string
  url: string | null
}

export type Fault = {
  signature: string
  version: string | null
  at: number
  sample: Sample
}

export type Incident = {
  signature: string
  version: string | null
  first: number
  last: number
  count: number
  sample: Sample
}

// UUIDs, object/trace ids, ULIDs, then numbers. Keep the words: different
// failures at the same call site must not collapse into one incident.
export let normalise = (text: string): string =>
  text
    .replace(/\b[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b/gi, '<id>')
    .replace(/\b(?:0x)?[\da-f]{16,}\b/gi, '<id>')
    .replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/g, '<id>')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()

let frame = (text: string) =>
  text.split('\n').find((line) => /^\s*at\s/.test(line))?.trim() ?? ''

export let signature = async (sample: Sample): Promise<string> => {
  let key = JSON.stringify([
    sample.name,
    normalise(sample.message.split(/\n\s*at\s/)[0]),
    frame(sample.stack || sample.message),
    sample.entrypoint,
  ])
  let bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(key),
  )
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** A late event cannot move `last` backwards or reopen an active outage. */
export let record = (previous: Incident | null, fault: Fault): {
  incident: Incident
  page: boolean
} => {
  let page = !previous || previous.signature != fault.signature ||
    fault.at - previous.last >= COOLDOWN
  let incident = page
    ? {
      signature: fault.signature,
      version: fault.version,
      first: fault.at,
      last: fault.at,
      count: 1,
      sample: fault.sample,
    }
    : {
      ...previous!,
      last: Math.max(previous!.last, fault.at),
      count: previous!.count + 1,
    }
  return { incident, page }
}

// Structural slices keep parsing testable in Deno; conform.ts checks the
// handler against Cloudflare's TraceItem, including non-fetch events.
export type Event = {
  scriptName?: string | null
  entrypoint?: string | null
  scriptVersion?: { id?: string } | null
  outcome: string
  eventTimestamp?: number | null
  event?: object | null
  exceptions?: { name: string; message: string; stack?: string }[]
  logs?: { level: string; message: unknown }[]
}

let text = (value: unknown): string => {
  if (typeof value == 'string') return value
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`
  }
  if (value && typeof value == 'object' && 'message' in value) {
    let e = value as { name?: string; message: unknown; stack?: string }
    return e.stack || `${e.name ?? 'Error'}: ${String(e.message)}`
  }
  return JSON.stringify(value) ?? String(value)
}

/** One occurrence per signature per invocation, even if it was logged twice. */
export let faults = async (
  event: Event,
  now = Date.now(),
): Promise<Fault[]> => {
  if (event.scriptName && event.scriptName != 'yak') return []
  let entrypoint = event.entrypoint || 'default'
  let exceptions = event.outcome == 'exception'
    ? [...event.exceptions ?? []]
    : []
  if (entrypoint == 'Store' || entrypoint == 'default') {
    for (let log of event.logs ?? []) {
      if (log.level != 'error') continue
      let message = (Array.isArray(log.message) ? log.message : [log.message])
        .map(text).join(' ')
      let named = message.match(/^([\w.]*Error|[\w.]*Exception):\s*/)
      exceptions.push({
        name: named?.[1] ?? 'console.error',
        message: named ? message.slice(named[0].length) : message,
        stack: message,
      })
    }
  }
  if (event.outcome == 'exception' && !exceptions.length) {
    exceptions.push({
      name: 'exception',
      message: 'exception outcome without exception text',
    })
  }
  let request = event.event && 'request' in event.event
    ? event.event.request as { url?: string }
    : null
  let unique = new Map<string, Fault>()
  for (let e of exceptions) {
    let sample: Sample = {
      name: e.name,
      message: e.message,
      stack: e.stack ?? '',
      entrypoint,
      // Use the runtime's redacted URL; never call getUnredacted().
      url: request?.url ?? null,
    }
    let id = await signature(sample)
    unique.set(id, {
      signature: id,
      version: event.scriptVersion?.id ?? null,
      at: event.eventTimestamp ?? now,
      sample,
    })
  }
  return [...unique.values()]
}
