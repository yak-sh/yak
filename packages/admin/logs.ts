// The owner’s view of yaks.app failures: tail watches live traffic through
// Wrangler, and errors reads grouped failures through the signed tracker door.
import { CallError } from '@yaks/tools/errors'
import { type Options, routes } from '@yaks/tracker/routes'
import { WRANGLER } from '../../workers/yak/wrangler.ts'
import { spawn, wasInterrupted } from './subprocess.ts'

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

export let duration = (since: string): number => {
  let match = /^(\d+)(s|m|h|d)?$/.exec(since)
  let seconds = match ? Number(match[1]) * UNITS[match[2] || 's'] : 0
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new CallError(
      'since',
      '--since needs a positive duration (for example 10m)',
    )
  }
  return seconds
}

let live = async (
  root: string,
  receive: (row: Row) => void,
  note: Note,
  signal: AbortSignal,
  start = spawn,
) => {
  // npx starts Wrangler as a child of its own, so stopping npx alone leaves
  // Wrangler alive with the pipe open. The tail is a process group of its own
  // (`detached`), and stopping it signals the whole group: SIGINT, so Wrangler
  // can close its tail session, then SIGKILL for whatever is still there after
  // GRACE. It runs until the command stops (the host's `stopping`).
  let run = start(WRANGLER[0], {
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
    let interrupted = run.stopped() || wasInterrupted(status)
    if (status.code != 0 && !interrupted) return status.code
    try {
      parser.finish()
    } catch (error) {
      if (!interrupted) throw error
      note('tail stopped during an event; that partial event was omitted')
    }
    return interrupted ? 130 : 0
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
  start = spawn,
): Promise<number> =>
  live(root, (row) => out(eventLine(row)), note, signal, start)

// The optional window matches unresolved bugs by their latest occurrence.
// Hits and first seen cover the whole group, including older samples.
export let errors = async (
  since: string | undefined,
  options: Options,
  out: Note,
  note: Note,
  fetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<void> => {
  let window = '', seen = ''
  if (since != undefined) {
    let seconds = duration(since), end = Date.now()
    let from = new Date(end - seconds * 1000).toISOString()
    let through = new Date(end).toISOString()
    window = ` .bug.last>=${from} .bug.last<=${through}`
    seen = ` last seen in preceding ${seconds}s`
  }
  let door = routes({}, options, fetch).find((r) => r.path == '/tracker/bugs')!
  let rows: import('@yaks/graph').Bundle[] = [], after = ''
  for (;;) {
    let query = `!resolved !archived${window} .order=-bug.last` +
      (after ? ` .after=${after}` : '')
    let params = new URLSearchParams({ query, limit: '100' })
    let response = await door.handle(
      new Request(`http://box/tracker/bugs?${params}`),
    )
    let body = await response.json()
    if (!response.ok) throw new CallError('tracker', body.error)
    if (!Array.isArray(body)) throw Error('tracker answered no bug rows')
    rows.push(...body)
    if (body.length < 100) break
    let cursor = body.at(-1)?.entity?.eid
    if (!cursor || cursor == after) throw Error('tracker repeated a bug page')
    after = cursor
  }
  note(
    `Tracker: ${rows.length} unresolved bugs from yaks.app and the box (not resolved or archived)${seen}, newest first; counts and first seen cover each bug's lifetime`,
  )
  out('COUNT  FIRST SEEN  LAST SEEN  BUG  PLACE  MESSAGE')
  for (let row of rows) {
    let bug = object(row.bug)
    out(
      [
        bug.hits,
        iso(time(bug.first)),
        iso(time(bug.last)),
        row.entity.eid,
        bug.spot || '-',
        text(object(row.doc).title),
      ].map(line).join('  '),
    )
  }
  out(
    `${
      rows.reduce((n, row) => n + Number(object(row.bug).hits || 0), 0)
    } occurrences, ${rows.length} bugs`,
  )
}
