// A session's transcript as the page draws it. Each entry is one yak entry
// (packages/session/README.md#the-transcript): what kind it is, and whether the
// transcript is still working, are @yaks/session's own reads (`kindOf`,
// `statusOf`, `openCalls`), so the page and the host never disagree about them.
// A model or a tool is a referenced entity; `name` turns its eid into words.
import { kindOf, openCalls, statusOf, textOf } from '@yaks/session/status'
import type { Bundle } from '@yaks/graph'
import { type LogRow } from './types.ts'

export type EntryRow = {
  eid: string
  seq: number
  comps: Record<string, Record<string, unknown>>
}

export type GraphLogEntry = {
  eid: string
  call?: string
  seq: number
  line: string
  row?: LogRow
}

export type GraphLog = {
  entries: GraphLogEntry[]
  activity?: { kind: 'tool' | 'model' | 'runner'; label: string }
  context?: number
}

/** The words for a referenced entity (a model, a tool), when they're held. */
export type Names = (eid: string) => string | undefined

let text = (value: unknown) => String(value ?? '')
let clip = (value: unknown, limit = 240) => {
  let out = text(value).replace(/\s+/g, ' ').trim()
  return out.length > limit ? `${out.slice(0, limit - 1)}…` : out
}

let bundle = (row: EntryRow): Bundle => ({
  entity: { eid: row.eid },
  ...row.comps,
})

// Token counts as the turn row serializes them. A provider reports either
// spelling (@yaks/model `usage`), so each count reads whichever is present.
let usage = (u?: Record<string, unknown>) => {
  if (!u) return undefined
  let n = (a: string, b: string) => Number(u[a] ?? u[b] ?? 0)
  return {
    input: n('input', 'input_tokens'),
    json: JSON.stringify({
      input_tokens: n('input', 'input_tokens'),
      cached_input_tokens: n('cached', 'cached_tokens'),
      output_tokens: n('output', 'output_tokens'),
      reasoning_tokens: n('reasoning', 'reasoning_tokens'),
    }),
  }
}

let toolOf = (c: EntryRow['comps'], name: Names) =>
  name(text(c.call?.to)) || 'tool'

let failure = (c: EntryRow['comps']) =>
  c.exception
    ? text(c.exception.message) || text(c.content?.body) || 'exception'
    : c.error
    ? [text(c.error.code), text(c.content?.body)].filter(Boolean).join(': ')
    : undefined

let shown = (
  row: EntryRow,
  byEid: Map<string, EntryRow>,
  name: Names,
): LogRow | undefined => {
  let c = row.comps
  let b = bundle(row)
  let kind = kindOf(b)
  if (kind == 'exception' || kind == 'error') {
    return { kind: 'error', text: failure(c)! }
  }
  if (kind == 'stop') return { kind: 'sys', tag: 'stop' }
  if (kind == 'ask') {
    let model = name(text(c.ask?.to)) ?? name(text(c.using?.model))
    let u = usage(c.usage)
    return u
      ? {
        kind: 'turn',
        model,
        usage: u.json,
        ...u.input ? { context: u.input } : {},
      }
      : { kind: 'sys', tag: 'ask', ...model ? { text: model } : {} }
  }
  if (kind == 'call') {
    let args = (c.call?.args ?? {}) as Record<string, unknown>
    let tool = toolOf(c, name)
    return typeof args.command == 'string'
      ? { kind: 'exec', command: args.command, desc: tool }
      : { kind: 'tool', name: tool, detail: clip(JSON.stringify(args)) }
  }
  if (kind == 'result') {
    let call = byEid.get(text(c.result?.call))
    let body = clip(textOf(b))
    let code = c.exit?.code == null ? undefined : Number(c.exit.code)
    return {
      kind: 'tool',
      name: `↳ ${call ? toolOf(call.comps, name) : 'tool'}`,
      ...body ? { detail: body } : {},
      ...code == null ? {} : { ok: code == 0 },
    }
  }
  if (c.cancel) {
    return { kind: 'sys', tag: 'cancel', text: text(c.cancel.target) }
  }
  if (c.checkpoint) return { kind: 'sys', tag: 'checkpoint' }
  if (c.attention) return { kind: 'sys', tag: 'attention' }
  let body = textOf(b)
  if (kind == 'output') {
    if (c.reasoning) return body ? { kind: 'reason', text: body } : undefined
    return { kind: 'say', role: 'agent', text: body }
  }
  if (kind == 'input') {
    // Instructions admitted into the transcript (@yaks/context `prompt`) and
    // passive context (`notice`) are the harness's, not something said.
    if (c.prompt) return { kind: 'sys', tag: 'instructions', text: clip(body) }
    if (c.notice) return { kind: 'sys', tag: 'notice', text: clip(body) }
    return { kind: 'say', role: 'user', text: body }
  }
  return undefined
}

// What the transcript is waiting on, when it's working: a call no result has
// answered yet, the model, or the daemon that has an input to ask about.
let activityOf = (
  bundles: Bundle[],
  name: Names,
): GraphLog['activity'] => {
  let status = statusOf(bundles)
  if (status != 'running' && status != 'pending') return undefined
  let call = openCalls(bundles).at(-1)
  if (call) {
    let tool = toolOf(call as EntryRow['comps'], name)
    let running = (call.execution as { state?: unknown } | undefined)?.state ==
      'running'
    return {
      kind: 'tool',
      label: running ? `running ${tool}…` : `waiting for ${tool}…`,
    }
  }
  return status == 'running'
    ? { kind: 'model', label: 'waiting for model…' }
    : { kind: 'runner', label: 'waiting for runner…' }
}

export let graphLog = (
  source: EntryRow[],
  name: Names = () => undefined,
): GraphLog => {
  let rows = source.toSorted((a, b) => a.seq - b.seq)
  let byEid = new Map(rows.map((row) => [row.eid, row]))
  let bundles = rows.map(bundle)
  let entries = rows.map((source) => {
    let row = shown(source, byEid, name)
    let at = text(source.comps.created?.at)
    if (row && at && !row.at) row = { ...row, at }
    return {
      eid: source.eid,
      ...(source.comps.result?.call
        ? { call: text(source.comps.result.call) }
        : {}),
      seq: source.seq,
      line: JSON.stringify({
        eid: source.eid,
        seq: source.seq,
        ...source.comps,
      }),
      ...(row ? { row } : {}),
    }
  })
  let context = entries.findLast((entry) => entry.row?.context)?.row?.context
  let activity = activityOf(bundles, name)
  return {
    entries,
    ...(activity ? { activity } : {}),
    ...(context ? { context } : {}),
  }
}

// Bound a rendered log's ENTRIES to an output page. graphLog must see the WHOLE
// partition to resolve call↔result, so a page bounds only what a reader
// returns, never what it reads: `tail` takes the last N rendered rows, else
// `after` is a seq cursor and `limit` a cap.
export let pageEntries = (
  entries: GraphLogEntry[],
  p: { after?: number; tail?: number; limit?: number },
): GraphLogEntry[] => {
  let tail = Math.max(0, p.tail ?? 0)
  let after = Math.max(0, p.after ?? 0)
  let limit = Math.max(0, p.limit ?? 0)
  let picked = tail > 0
    ? entries.slice(-tail)
    : entries.filter((entry) => entry.seq > after)
  return limit > 0 ? picked.slice(0, limit) : picked
}
