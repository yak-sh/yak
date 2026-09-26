// The owner's view of yaks.app's failures: `tail` watches live traffic
// through Wrangler's login, and `errors` reads the past from Sentry. Sentry is
// the one record that holds them all: every failure the platform throws, logs
// with console.error, or catches and answers (workers/yak/sentry.ts `caught`,
// `defect`) is sent there, while Workers Logs is sampled and never sees a
// failure a catch answered without a console line. Sentry is read with a
// token that can read the org (`org:read`), kept in this box's vault as
// `sentry`, an op:// reference, never a deployment secret. Without one,
// `errors` refuses and says how to keep it; it never watches the future in
// place of the past.
import { CallError } from '@yaks/tools'
import { WRANGLER } from '../../workers/yak/wrangler.ts'
import { spawn } from './subprocess.ts'

export { GRACE } from './subprocess.ts'

type Note = (line: string) => void
type Row = Record<string, unknown>
let object = (v: unknown): Row =>
  v && typeof v == 'object' && !Array.isArray(v) ? v as Row : {}
let text = (v: unknown): string =>
  typeof v == 'string' ? v : v == null ? '' : JSON.stringify(v)
let line = (v: unknown) => text(v).replace(/\s+/g, ' ').trim()
let time = (v: unknown): number => {
  let n = typeof v == 'number' ? v : Date.parse(text(v))
  return Number.isFinite(n) ? n : 0
}
let iso = (n: number) => n ? new Date(n).toISOString() : '?'

export type Fault = {
  message: string
  frame: string
  entrypoint: string
  timestamp: number
  version: string
}

// A message can itself contain a serialized Error, so look there too when
// console.error supplied no separate stack field.
let frameOf = (stack: unknown) =>
  text(stack).split('\n').map((s) => s.trim()).find((s) => /^at\s/.test(s)) ??
    ''

let messageOf = (part: unknown) => {
  let value = object(part)
  if (value.message != null) {
    return [text(value.name), text(value.message)].filter(Boolean).join(': ')
  }
  if (value.stack != null) {
    let head = text(value.stack).split('\n')[0]
    return /^\s*at\s/.test(head) ? '' : head
  }
  return text(part)
}

let entrypointOf = (row: Row): string => {
  if (row.entrypoint || row.eventType) {
    return text(row.entrypoint || row.eventType)
  }
  let event = object(row.event)
  for (
    let [key, name] of [
      ['request', 'fetch'],
      ['cron', 'scheduled'],
      ['rpcMethod', 'rpc'],
      ['queue', 'queue'],
      ['scheduledTime', 'alarm'],
      ['mailFrom', 'email'],
      ['consumedEvents', 'tail'],
    ]
  ) if (key in event) return name
  return 'default'
}

export let faultsOf = (row: Row): Fault[] => {
  let entrypoint = entrypointOf(row)
  let version = text(object(row.scriptVersion).id) || '?'
  let base = { entrypoint, version }
  let faults: Fault[] = []
  for (let value of Array.isArray(row.exceptions) ? row.exceptions : []) {
    let error = object(value)
    let message = [text(error.name), text(error.message)].filter(Boolean).join(
      ': ',
    )
    faults.push({
      ...base,
      message: message.split('\n')[0],
      frame: frameOf(error.stack) || frameOf(message),
      timestamp: time(error.timestamp ?? row.eventTimestamp),
    })
  }
  for (let value of Array.isArray(row.logs) ? row.logs : []) {
    let log = object(value)
    if (log.level != 'error') continue
    let parts = Array.isArray(log.message) ? log.message : [log.message]
    let message = parts.map(messageOf).filter(Boolean).join(' ')
    let frame = frameOf(log.stack) ||
      parts.map((part) => frameOf(object(part).stack) || frameOf(part)).find(
        Boolean,
      ) || ''
    faults.push({
      ...base,
      message: message.split('\n')[0],
      frame,
      timestamp: time(log.timestamp ?? row.eventTimestamp),
    })
  }
  return faults
}

export let eventLine = (row: Row): string => {
  let event = object(row.event)
  let request = object(event.request)
  let entrypoint = entrypointOf(row)
  let detail = [object(event.response).status, request.method, request.url]
    .filter((v) => v != null).map(text).join(' ')
  let errors = faultsOf(row).map((f) =>
    `${f.message}${f.frame ? ` ${f.frame}` : ''}`
  )
  return [
    iso(time(row.eventTimestamp)),
    text(row.outcome) || '?',
    entrypoint,
    detail || '-',
    errors.join(' | '),
  ].map(line).filter(Boolean).join('  ')
}

// Wrangler pretty-prints JSON even with --format json. A pipe chunk is not a
// record or a line: track braces outside strings across arbitrary chunks.
export let records = (receive: (row: Row) => void) => {
  let pending = '', depth = 0, quoted = false, escaped = false, skipped = false
  return {
    push(chunk: string) {
      for (let char of chunk) {
        if (!depth) {
          if (char == '\n') skipped = false
          if (skipped || /\s/.test(char)) continue
          if (char != '{') {
            skipped = true
            continue
          }
        }
        pending += char
        if (quoted) {
          if (escaped) escaped = false
          else if (char == '\\') escaped = true
          else if (char == '"') quoted = false
        } else if (char == '"') quoted = true
        else if (char == '{' || char == '[') depth++
        else if (char == '}' || char == ']') depth--
        if (!depth) {
          receive(object(JSON.parse(pending)))
          pending = ''
        }
      }
    },
    finish() {
      if (pending) throw new Error('wrangler tail ended inside a JSON event')
    },
  }
}

let UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 }

// Sentry keeps events for 90 days at most, so a longer window asks for
// nothing more.
export let duration = (since = '10m'): number => {
  let match = /^(\d+)(s|m|h|d)?$/.exec(since)
  let seconds = match ? Number(match[1]) * UNITS[match[2] || 's'] : 0
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 90 * 86_400) {
    throw new CallError(
      'since',
      '--since needs a duration from 1s to 90d (for example 10m)',
    )
  }
  return seconds
}

let live = async (
  root: string,
  receive: (row: Row) => void,
  note: Note,
  signal: AbortSignal,
) => {
  // npx starts Wrangler as a child of its own, so stopping npx alone leaves
  // Wrangler alive with the pipe open. The tail is a process group of its own
  // (`detached`), and stopping it signals the whole group: SIGINT, so Wrangler
  // can close its tail session, then SIGKILL for whatever is still there after
  // GRACE. It runs until the command stops (the host's `stopping`).
  let run = spawn(WRANGLER[0], {
    args: [...WRANGLER.slice(1), 'tail', '--format', 'json'],
    cwd: `${root}/workers/yak`,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'inherit',
  }, signal)
  let child = run.child
  let parser = records(receive)
  try {
    for await (let chunk of child.stdout.pipeThrough(new TextDecoderStream())) {
      parser.push(chunk)
    }
    let status = await child.status
    if (status.code != 0 && !run.stopped()) return status.code
    try {
      parser.finish()
    } catch (error) {
      if (!run.stopped()) throw error
      note('tail stopped during an event; that partial event was omitted')
    }
    return run.stopped() ? 130 : 0
  } finally {
    run.stop()
    await run.finish()
  }
}

export let tail = (
  root: string,
  out: Note,
  note: Note,
  signal: AbortSignal,
): Promise<number> => live(root, (row) => out(eventLine(row)), note, signal)

/** Where yaks.app's failures go: workers/yak/sentry.ts's org and project. */
export let SENTRY = {
  api: 'https://us.sentry.io/api/0',
  org: 'yaks',
  project: 'yaks-app',
  environment: 'production',
}

// The name the Sentry token is kept under in this box's vault.
export let TOKEN = 'sentry'

// Said when there is no token, or Sentry refuses the one kept: where to make
// one, the one line that keeps a reference to it, and the door for live
// traffic.
let keepIt = (why: string) =>
  new CallError(
    TOKEN,
    `${why}. Reading Sentry needs a token that can read the ${SENTRY.org} ` +
      'org (org:read), made at sentry.io → User Settings → Personal Tokens. ' +
      "Keep an op:// reference to one in this box's vault, once:\n  yak " +
      `graph apply --change '[{"entity":{"eid":"$s"},"secret":{"name":` +
      `"${TOKEN}","value":"op://<vault>/<item>/<field>"}}]'\nLive traffic ` +
      'is `yak admin tail --admin`.',
  )

// One row per issue and the door it broke at, over the window.
let FIELDS = [
  'issue',
  'title',
  'request',
  'count()',
  'min(timestamp)',
  'max(timestamp)',
]

/** The events query for the `seconds` before `end`, one page at `cursor`.
 * API contract:
 * https://docs.sentry.io/api/explore/query-explore-events-in-table-format/ */
export let asked = (seconds: number, end: number, cursor?: string) => {
  let q = new URLSearchParams({
    dataset: 'errors',
    project: SENTRY.project,
    environment: SENTRY.environment,
    start: new Date(end - seconds * 1000).toISOString(),
    end: new Date(end).toISOString(),
    sort: '-count()',
    per_page: '100',
  })
  for (let f of FIELDS) q.append('field', f)
  if (cursor) q.set('cursor', cursor)
  return `${SENTRY.api}/organizations/${SENTRY.org}/events/?${q}`
}

/** The cursor of the next page a Sentry `Link` header offers, when that page
 * has results. */
export let next = (link: string | null) =>
  /rel="next"; results="true"; cursor="([^"]+)"/.exec(link ?? '')?.[1]

let history = async (
  seconds: number,
  token: string,
  fetch: typeof globalThis.fetch,
): Promise<Row[]> => {
  let end = Date.now()
  let rows: Row[] = [], cursor: string | undefined
  let seen = new Set<string>()
  for (;;) {
    let res = await fetch(asked(seconds, end, cursor), {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status == 401 || res.status == 403) {
      await res.body?.cancel()
      throw keepIt(`Sentry refused the ${TOKEN} token (${res.status})`)
    }
    if (!res.ok) {
      throw new Error(
        `the Sentry events query answered ${res.status}: ` +
          line(await res.text()).slice(0, 300),
      )
    }
    let data = object(await res.json()).data
    if (!Array.isArray(data)) {
      throw new Error('the Sentry events query answered no rows')
    }
    rows.push(...data.map(object))
    cursor = next(res.headers.get('link'))
    if (!cursor) return rows
    if (seen.has(cursor)) throw new Error('Sentry repeated a page')
    seen.add(cursor)
  }
}

// The preceding window, or a refusal: never the next one in its place.
export let errors = async (
  since: string | undefined,
  token: string | undefined,
  out: Note,
  note: Note,
  fetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<void> => {
  let seconds = duration(since)
  if (!token) throw keepIt(`No ${TOKEN} token is kept on this box`)
  let rows = await history(seconds, token, fetch)
  note(
    `Sentry ${SENTRY.org}/${SENTRY.project} (${SENTRY.environment}): ` +
      `preceding ${seconds}s; each issue is at ` +
      `https://${SENTRY.org}.sentry.io/issues/<ISSUE>`,
  )
  out('COUNT  FIRST SEEN  LAST SEEN  ISSUE  REQUEST  MESSAGE')
  for (let r of rows) {
    out(
      [
        r['count()'],
        iso(time(r['min(timestamp)'])),
        iso(time(r['max(timestamp)'])),
        r.issue,
        r.request || '-',
        r.title,
      ].map(line).join('  '),
    )
  }
  let events = rows.reduce((n, r) => n + (Number(r['count()']) || 0), 0)
  out(`${events} events, ${new Set(rows.map((r) => r.issue)).size} issues`)
}
