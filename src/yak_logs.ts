// The owner's view of yaks.app logs. Wrangler holds this box's login; a
// historical query may use that same token, but never a deployment secret.
import { parse } from '@std/toml'
import { Usage } from '@yaks/cli'
import { WRANGLER } from '../workers/yak/wrangler.ts'

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
export type Group = Omit<Fault, 'timestamp' | 'version'> & {
  count: number
  first: number
  last: number
  versions: string[]
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

// Version is evidence, not part of the signature: the same bug can span a
// deploy. Keep every version so that a change never hides its earlier count.
export let grouped = (faults: Fault[]): Group[] => {
  let groups = new Map<string, Group>()
  for (let fault of faults) {
    let { message, frame, entrypoint, timestamp, version } = fault
    let key = JSON.stringify([message, frame, entrypoint])
    let group = groups.get(key)
    if (!group) {
      group = {
        message,
        frame,
        entrypoint,
        count: 0,
        first: timestamp,
        last: timestamp,
        versions: [],
      }
      groups.set(key, group)
    }
    group.count++
    if (timestamp) {
      group.first = group.first ? Math.min(group.first, timestamp) : timestamp
    }
    group.last = Math.max(group.last, timestamp)
    if (!group.versions.includes(version)) group.versions.push(version)
  }
  return [...groups.values()].map((g) => ({
    ...g,
    versions: g.versions.sort(),
  }))
    .sort((a, b) => b.count - a.count || a.message.localeCompare(b.message))
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

export let duration = (since = '10m'): number => {
  let match = /^(\d+)(s|m|h)?$/.exec(since)
  let seconds = match
    ? Number(match[1]) * ({ s: 1, m: 60, h: 3600 }[match[2] || 's'] ?? 0)
    : 0
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 86_400) {
    throw new Usage('--since needs a duration from 1s to 24h (for example 10m)')
  }
  return seconds
}

let live = async (
  root: string,
  receive: (row: Row) => void,
  note: Note,
  seconds = 0,
) => {
  // GNU timeout owns a process group: stopping only npx leaves its Wrangler
  // child alive with the pipe open. Zero means tail until the owner stops it.
  let child = new Deno.Command('timeout', {
    args: [
      '--signal=INT',
      '--kill-after=5s',
      `${seconds}s`,
      ...WRANGLER,
      'tail',
      '--format',
      'json',
    ],
    cwd: `${root}/workers/yak`,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'inherit',
  }).spawn()
  let stopped = false
  let stop = () => {
    stopped = true
    try {
      child.kill('SIGINT')
    } catch { /* Already exited. */ }
  }
  Deno.addSignalListener('SIGINT', stop)
  Deno.addSignalListener('SIGTERM', stop)
  let parser = records(receive)
  try {
    for await (let chunk of child.stdout.pipeThrough(new TextDecoderStream())) {
      parser.push(chunk)
    }
    let status = await child.status
    if (status.code != 0 && status.code != 124 && !stopped) return status.code
    try {
      parser.finish()
    } catch (error) {
      if (status.code != 124 && !stopped) throw error
      note('tail stopped during an event; that partial event was omitted')
    }
    if (seconds && status.code != 124 && !stopped) {
      note('wrangler tail ended before the observation window finished')
      return 1
    }
    return stopped ? 130 : 0
  } finally {
    Deno.removeSignalListener('SIGINT', stop)
    Deno.removeSignalListener('SIGTERM', stop)
    stop()
    await child.status
  }
}

// The query API uses a separate row per log or exception. Adapt it to the
// tail shape, so both feeds share exactly the same signature computation.
export let queried = (row: Row): Row => {
  let meta = object(row.$metadata)
  let worker = object(row.$workers)
  let source = object(row.source)
  let timestamp = row.timestamp
  let message = source.message ?? meta.error ?? meta.message ?? row.source
  let exception = source.exception ??
    (typeof source.error == 'object' ? source.error : undefined)
  let exceptions = Array.isArray(source.exceptions)
    ? source.exceptions
    : exception
    ? [exception]
    : []
  let bad = !!meta.error || meta.level == 'error' || source.level == 'error'
  return {
    ...worker,
    eventTimestamp: timestamp,
    entrypoint: worker.entrypoint ?? worker.eventType ?? meta.origin,
    exceptions: exceptions.map((value) => ({ timestamp, ...object(value) })),
    logs: bad && !exceptions.length
      ? [{
        level: 'error',
        timestamp,
        message: Array.isArray(message) ? message : [message],
        stack: source.stack ??
          (typeof row.source == 'string' ? row.source : undefined),
      }]
      : [],
  }
}

let history = async (root: string, seconds: number): Promise<Row[] | null> => {
  // Capture the token without ever printing stdout or stderr. This command
  // also refreshes Wrangler's OAuth login; no second credential is needed.
  let [cmd, ...args] = WRANGLER
  let auth = await new Deno.Command(cmd, {
    args: [...args, 'auth', 'token', '--json'],
    cwd: `${root}/workers/yak`,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'null',
  }).output()
  if (!auth.success) return null
  let credential = object(JSON.parse(new TextDecoder().decode(auth.stdout)))
  if (typeof credential.token != 'string') return null
  let config = parse(
    await Deno.readTextFile(`${root}/workers/yak/wrangler.toml`),
  )
  let account = text(config.account_id)
  if (!account) return null
  let end = Date.now()
  let rows: Row[] = [], offset: string | undefined
  let seen = new Set<string>()
  // API contract: https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/
  for (;;) {
    let res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/workers/observability/telemetry/query`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${credential.token}`,
          'content-type': 'application/json',
        },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          queryId: 'yak-errors',
          view: 'events',
          dry: true,
          limit: 2000,
          timeframe: { from: end - seconds * 1000, to: end },
          offset,
          offsetDirection: 'next',
          parameters: {
            datasets: ['cloudflare-workers'],
            filterCombination: 'and',
            filters: [{
              key: '$metadata.service',
              operation: 'eq',
              type: 'string',
              value: text(config.name),
            }],
          },
        }),
      },
    )
    if (!res.ok) {
      await res.body?.cancel()
      return null
    }
    let body = object(await res.json())
    let result = object(body.result)
    let events = object(result.events)
    if (body.success === false || !Array.isArray(events.events)) return null
    let page = events.events.map(object)
    rows.push(...page)
    if (page.length < 2000) return rows
    offset = text(object(page.at(-1)?.$metadata).id)
    if (!offset || seen.has(offset)) return null
    seen.add(offset)
  }
}

export let tail = (root: string, out: Note, note: Note): Promise<number> =>
  live(root, (row) => out(eventLine(row)), note)

export let errors = async (
  root: string,
  since: string | undefined,
  out: Note,
  note: Note,
): Promise<number> => {
  let seconds = duration(since)
  let rows = await history(root, seconds).catch(() => null)
  let faults: Fault[] = [], code = 0, count = 0
  let receive = (row: Row) => {
    count++
    faults.push(...faultsOf(row))
  }
  if (rows) {
    note(
      `Workers Logs query: preceding ${seconds}s; stored logs may be sampled`,
    )
    rows.forEach((row) => receive(queried(row)))
  } else {
    note(
      `Workers Logs query unavailable with this box's login. Watching the NEXT ${seconds}s through wrangler tail; this is live traffic, not historical logs.`,
    )
    code = await live(root, receive, note, seconds)
  }
  let groups = grouped(faults)
  out('COUNT  FIRST SEEN  LAST SEEN  VERSION  ENTRYPOINT  MESSAGE / TOP FRAME')
  for (let group of groups) {
    out(
      [
        group.count,
        iso(group.first),
        iso(group.last),
        group.versions.join(','),
        group.entrypoint,
        group.message,
        group.frame || '(no stack)',
      ].map(line).join('  '),
    )
  }
  out(`${count} events, ${faults.length} errors, ${groups.length} signatures`)
  return code
}
