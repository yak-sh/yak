// The owner's view of yaks.app logs: `tail` watches live traffic through
// Wrangler's login, and `errors` reads the past from Workers Logs. That
// login cannot read the past: Wrangler's OAuth offers no Workers
// Observability scope, and the query answers its token 403. So history reads
// with a read-only API token this box's vault keeps as `cloudflare
// observability`, an op:// reference, never a deployment secret. Without one,
// `errors` refuses and says how to keep it; it never watches the future in
// place of the past.
import { parse } from '@std/toml'
import { CallError } from '@yaks/tools'
import { WRANGLER } from '../../workers/yak/wrangler.ts'

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
    throw new CallError(
      'since',
      '--since needs a duration from 1s to 24h (for example 10m)',
    )
  }
  return seconds
}

let live = async (
  root: string,
  receive: (row: Row) => void,
  note: Note,
) => {
  // GNU timeout owns a process group: stopping only npx leaves its Wrangler
  // child alive with the pipe open. Zero means tail until the owner stops it.
  let child = new Deno.Command('timeout', {
    args: [
      '--signal=INT',
      '--kill-after=5s',
      '0s',
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
    if (status.code != 0 && !stopped) return status.code
    try {
      parser.finish()
    } catch (error) {
      if (!stopped) throw error
      note('tail stopped during an event; that partial event was omitted')
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
// The invocation itself is a row of its own (`cf-worker-event`), marked error
// when it threw and carrying only its trigger as a message, so it is counted
// and never a fault: what it threw arrives as the rows beside it. An
// exception row keeps its message beside the exception, not in it.
export let invocation = (row: Row) =>
  object(row.$metadata).type == 'cf-worker-event'

export let queried = (row: Row): Row => {
  let meta = object(row.$metadata)
  let worker = object(row.$workers)
  let source = object(row.source)
  let timestamp = row.timestamp
  let message = source.message ?? meta.error ?? meta.message ?? row.source
  let exception = source.exception ??
    (typeof source.error == 'object' ? source.error : undefined)
  let exceptions = invocation(row)
    ? []
    : Array.isArray(source.exceptions)
    ? source.exceptions
    : exception
    ? [{ message: source.message, ...object(exception) }]
    : []
  let bad = !invocation(row) &&
    (!!meta.error || meta.level == 'error' || source.level == 'error')
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

// The name the history token is kept under in this box's vault.
export let OBSERVABILITY = 'cloudflare observability'

// Said when there is no token, or Cloudflare refuses the one kept: the one
// line that keeps a reference to it, and the door for live traffic.
let keepIt = (why: string) =>
  new CallError(
    'observability',
    `${why}. Workers Logs needs a Cloudflare API token that can read Workers ` +
      'Observability, which a Wrangler login cannot carry. Keep an op:// ' +
      `reference to one in this box's vault, once:\n  yak graph apply ` +
      `--change '[{"entity":{"eid":"$s"},"secret":{"name":"${OBSERVABILITY}",` +
      `"value":"op://<vault>/<item>/<field>"}}]'\nLive traffic is ` +
      '`yak admin tail --admin`.',
  )

let history = async (
  root: string,
  seconds: number,
  token: string,
): Promise<Row[]> => {
  let config = parse(
    await Deno.readTextFile(`${root}/workers/yak/wrangler.toml`),
  )
  let account = text(config.account_id)
  if (!account) throw new Error('workers/yak/wrangler.toml names no account')
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
          authorization: `Bearer ${token}`,
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
    if (res.status == 401 || res.status == 403) {
      await res.body?.cancel()
      throw keepIt(
        `Cloudflare refused the ${OBSERVABILITY} token (${res.status})`,
      )
    }
    if (!res.ok) {
      await res.body?.cancel()
      throw new Error(`the Workers Logs query answered ${res.status}`)
    }
    let body = object(await res.json())
    let events = object(object(body.result).events)
    if (body.success === false || !Array.isArray(events.events)) {
      throw new Error('the Workers Logs query answered no events')
    }
    let page = events.events.map(object)
    rows.push(...page)
    if (page.length < 2000) return rows
    offset = text(object(page.at(-1)?.$metadata).id)
    if (!offset || seen.has(offset)) {
      throw new Error('the Workers Logs query repeated a page')
    }
    seen.add(offset)
  }
}

export let tail = (root: string, out: Note, note: Note): Promise<number> =>
  live(root, (row) => out(eventLine(row)), note)

// The preceding window, or a refusal: never the next one in its place.
export let errors = async (
  root: string,
  since: string | undefined,
  token: string | undefined,
  out: Note,
  note: Note,
): Promise<void> => {
  let seconds = duration(since)
  if (!token) throw keepIt(`No ${OBSERVABILITY} token is kept on this box`)
  let rows = await history(root, seconds, token)
  note(`Workers Logs query: preceding ${seconds}s; stored logs may be sampled`)
  let faults = rows.flatMap((row) => faultsOf(queried(row)))
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
  out(
    `${
      rows.filter(invocation).length
    } events, ${faults.length} errors, ${groups.length} signatures`,
  )
}
