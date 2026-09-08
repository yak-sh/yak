// The incident is also the cooldown: thirty quiet minutes end an outage.
// Rows stay readable by `yak errors` after the outage ends.
export let COOLDOWN = 30 * 60 * 1000
// A signature back after the cooldown is the same defect persisting — an
// hourly job failing every hour is one break, not an outage an hour (T-34844).
// It pages again only when it survives a deploy, or after a quiet day.
export let REPAGE = 24 * 60 * 60 * 1000
// Cloudflare resetting a Durable Object mid-request is theirs and passing;
// one is weather, two inside an hour is a break worth a page.
export let PATIENCE = 60 * 60 * 1000

// The runtime's own words for the two resets. The first is what every deploy
// does to an object with a request in flight: a deploy event, never a fault.
let DEPLOY_RESET = /^Durable Object reset because its code was updated\.?$/
let STORAGE_RESET =
  /^Internal error in Durable Object storage caused object to be reset/

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
  // Set on a fault that pages only when it repeats within this many ms.
  patience?: number
}

export type Incident = {
  signature: string
  version: string | null
  first: number
  last: number
  count: number
  sample: Sample
}

// UUIDs, object/trace ids, ULIDs, Cloudflare references, then numbers. Keep
// the words: different failures at the same call site must not collapse into
// one incident.
export let normalise = (text: string): string =>
  text
    .replace(/\b[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b/gi, '<id>')
    .replace(/\b(?:0x)?[\da-f]{16,}\b/gi, '<id>')
    .replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/g, '<id>')
    .replace(/\b(?=[a-z]*\d)(?=\d*[a-z])[a-z\d]{20,}\b/g, '<id>')
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
  let fresh = !previous || previous.signature != fault.signature
  let quiet = fresh ? Infinity : fault.at - previous!.last
  let again = quiet >= COOLDOWN
  // A patient fault pages on its second occurrence inside the window, and
  // never on a first — not even one that opens a new outage after a deploy.
  let page = fault.patience
    ? !fresh && !again && previous!.count == 1 &&
      fault.at - previous!.first <= fault.patience
    : fresh ||
      (again && (previous!.version != fault.version || quiet >= REPAGE))
  let incident = again
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
    if (DEPLOY_RESET.test(e.message.trim())) {
      console.log(
        `yak-tail: deploy reset ${entrypoint} ${event.scriptVersion?.id ?? ''}`,
      )
      continue
    }
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
      ...(STORAGE_RESET.test(e.message) ? { patience: PATIENCE } : {}),
    })
  }
  return [...unique.values()]
}
