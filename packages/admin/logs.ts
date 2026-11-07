import { freshFetch } from '@yaks/process/http'
// The owner’s view of yaks.app failures: tail watches live traffic through
// Wrangler, and errors reads grouped failures through the signed tracker door.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { human } from '@yaks/id'
import {
  answers,
  answersSince,
  arrived,
  automated,
  sender,
} from '@yaks/mail/answers'
import { span, spread } from '@yaks/tracker/fixtime'
import {
  duration,
  errors as trackerErrors,
  windowOf,
} from '@yaks/tracker/errors'
import type { Options } from '@yaks/tracker/routes'
import { WRANGLER } from '@yaks/cloudflare/wrangler'
import { spawn, wasInterrupted } from './subprocess.ts'

export { GRACE } from './subprocess.ts'
export { duration }

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

let live = async (
  root: string,
  receive: (row: Row) => void,
  note: Note,
  signal: AbortSignal,
  start = spawn,
) => {
  // Wrangler may start children with the pipe open. The tail is a process group of its own
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

// Every bug the tracker's signed door answers for a query, page by page.
// The platform's own addresses: what a person writes to, and what a letter
// from is never a person's.
let OURS = /@(?:[\w-]+\.)*(?:bot\.yak\.sh|yaks\.app)$/i
let ours = (address: string) => OURS.test(address)

// People's letters beside the bugs: each letter a person wrote to one of the
// platform's addresses in the window, how long until an answer to it
// left (@yaks/mail/answers), and every one still waiting. Archiving a letter
// says it needs no answer.
let letters = async (
  graph: Pick<Graph, 'read' | 'vocab'>,
  from: string,
  end: number,
  last: string,
): Promise<string[]> => {
  let got = (await graph.read(
    `!deliver .mail.at>=${from} ?mail ?doc ?archived .limit=1000`,
  )).filter((b) => {
    let who = sender(b), to = String((b.mail as Comp | undefined)?.to ?? '')
    return ours(to) && who && !ours(who) && !automated(who)
  })
  let sent = await graph.read(`${answersSince(from)} .limit=1000`)
  let paired = answers(got, sent), id = human(graph.vocab)
  let { count, median, worst } = spread(
    paired.flatMap((a) =>
      a.ms == undefined ? [] : [{ ms: a.ms, of: a.letter }]
    ),
  )
  let title = (b: Bundle) =>
    line((b.doc as Comp | undefined)?.title).slice(0, 80)
  return [
    `People's letters in the last ${last}: ${got.length}, answered ${count}` +
    (worst
      ? `, median ${span(median!)}, worst ${span(worst.ms)} (${id(worst.of)} ${
        title(worst.of)
      })`
      : ''),
    ...paired.filter((a) => !a.answer && !a.letter.archived).map((
      { letter },
    ) =>
      `Unanswered ${span(end - arrived(letter))}: ${id(letter)} from ${
        sender(letter)
      }  ${title(letter)}`
    ),
  ]
}

// The report's lines, the tool's answer on every door (@yaks/tracker/errors).
// Given the graph, people's letters in the same window follow.
export let errors = async (
  since: string | undefined,
  options: Options,
  { fetch = freshFetch(), graph, resolved = false }: {
    fetch?: typeof globalThis.fetch
    graph?: Pick<Graph, 'read' | 'vocab'>
    resolved?: boolean
  } = {},
): Promise<string[]> => {
  let end = Date.now()
  let report = await trackerErrors(since, options, { fetch, resolved, end })
  if (!graph) return report
  let { from, last } = windowOf(since, end)
  return [...report, ...await letters(graph, from, end, last)]
}
