// The provider-neutral face of a graph-native Session partition. Ordered
// entry facets become the same LogRow vocabulary the process-backed adapters
// serve, while readiness remains derived from leases and outcomes.
import { type LogRow } from './types.ts'

export type EntryRow = {
  eid: string
  seq: number
  comps: Record<string, Record<string, unknown>>
}

export type GraphLogEntry = {
  seq: number
  line: string
  row?: LogRow
}

export type GraphLog = {
  entries: GraphLogEntry[]
  busy: boolean
  latest: number
  model?: string
  stderr?: string
  context?: number
}

let text = (value: unknown) => String(value ?? '')
let clip = (value: unknown, limit = 240) => {
  let out = text(value).replace(/\s+/g, ' ').trim()
  return out.length > limit ? `${out.slice(0, limit - 1)}…` : out
}

let toolName = (comps: EntryRow['comps']) =>
  comps.bash
    ? 'shell'
    : comps.patch
    ? 'apply_patch'
    : comps.task_context
    ? 'task_context'
    : comps.graph_query
    ? 'graph_query'
    : comps.apply
    ? 'graph_apply'
    : 'tool'

let detail = (comps: EntryRow['comps']) =>
  comps.patch
    ? text(comps.patch.path || '.')
    : comps.graph_query
    ? clip(comps.graph_query.query)
    : comps.apply
    ? clip(comps.apply.change)
    : undefined

let usage = (comps: EntryRow['comps']) =>
  comps.usage
    ? JSON.stringify({
      input_tokens: Number(comps.usage.input ?? 0),
      cached_input_tokens: Number(comps.usage.cached ?? 0),
      output_tokens: Number(comps.usage.output ?? 0),
      reasoning_tokens: Number(comps.usage.reasoning ?? 0),
    })
    : undefined

let shown = (
  row: EntryRow,
  byEid: Map<string, EntryRow>,
): LogRow | undefined => {
  let c = row.comps
  if (c.error) return { kind: 'error', text: text(c.error.message) }
  if (c.message) {
    return {
      kind: 'say',
      role: c.message.role == 'user' ? 'user' : 'agent',
      text: text(c.content?.body),
    }
  }
  if (c.reasoning) {
    let body = text(c.content?.body)
    return body ? { kind: 'reason', text: body } : undefined
  }
  if (c.generation) {
    let model = text(c.generation.serving_model || c.generation.model)
    if (c.delivered || c.usage) {
      return { kind: 'turn', model, usage: usage(c) }
    }
    return { kind: 'sys', tag: 'generation', text: model }
  }
  if (c.attention) return { kind: 'sys', tag: 'attention' }
  if (c.call) {
    if (c.bash) {
      return {
        kind: 'exec',
        command: text(c.bash.command),
        desc: 'Command',
      }
    }
    return { kind: 'tool', name: toolName(c), detail: detail(c) }
  }
  if (c.result) {
    let call = byEid.get(text(c.result.call))
    let name = call ? toolName(call.comps) : 'tool'
    let body = clip(c.content?.body)
    let stderr = clip(c.stderr?.text)
    let code = c.exit?.code == null ? undefined : Number(c.exit.code)
    return {
      kind: 'tool',
      name: `↳ ${name}`,
      ...body ? { detail: body } : {},
      ...code == null ? {} : { ok: code == 0 },
      ...stderr ? { error: stderr } : {},
    }
  }
  if (c.checkpoint) {
    return { kind: 'sys', tag: 'checkpoint', text: clip(c.content?.body) }
  }
  if (c.cancel) {
    return { kind: 'sys', tag: 'cancel', text: text(c.cancel.target) }
  }
  if (c.opaque) {
    let format = text(c.opaque.format)
    return format.startsWith('openai:failed:')
      ? undefined
      : { kind: 'sys', tag: format }
  }
  return undefined
}

let raw = (row: EntryRow) =>
  JSON.stringify({ eid: row.eid, seq: row.seq, ...row.comps })

export let graphLog = (source: EntryRow[]): GraphLog => {
  let rows = source.toSorted((a, b) => a.seq - b.seq)
  let byEid = new Map(rows.map((row) => [row.eid, row]))
  let cancelled = new Set(
    rows.flatMap((row) =>
      row.comps.cancel?.target ? [text(row.comps.cancel.target)] : []
    ),
  )
  let results = new Set(
    rows.flatMap((row) =>
      row.comps.result?.call ? [text(row.comps.result.call)] : []
    ),
  )
  let outputs = new Set(
    rows.flatMap((row) =>
      row.comps.output?.source ? [text(row.comps.output.source)] : []
    ),
  )
  let busy = rows.some((row) => {
    let c = row.comps
    if (c.lease) return true
    if (c.error || cancelled.has(row.eid)) return false
    if (c.generation) {
      return !c.delivered && !outputs.has(row.eid)
    }
    return !!c.call && !results.has(row.eid)
  })
  let model = rows.filter((row) => row.comps.generation).at(-1)?.comps
    .generation
  let entries = rows.map((source) => {
    let row = shown(source, byEid)
    if (row?.kind == 'turn' && source.comps.usage) {
      let context = Number(source.comps.usage.input ?? 0)
      if (context > 0) row = { ...row, context }
    }
    return {
      seq: source.seq,
      line: raw(source),
      ...(row ? { row } : {}),
    }
  })
  let context = entries.findLast((entry) => entry.row?.context)?.row?.context
  return {
    entries,
    busy,
    latest: rows.at(-1)?.seq ?? 0,
    ...(context ? { context } : {}),
    ...model ? { model: text(model.serving_model || model.model) } : {},
  }
}

export let graphLogPage = (
  rows: EntryRow[],
  q: URLSearchParams,
): GraphLog => {
  let log = graphLog(rows)
  let limit = Math.max(0, Number(q.get('limit')) || 0)
  let tail = Math.max(0, Number(q.get('tail')) || 0)
  let after = Math.max(0, Number(q.get('after')) || 0)
  let picked = tail > 0
    ? log.entries.slice(-tail)
    : log.entries.filter((entry) => entry.seq > after)
  return {
    ...log,
    entries: limit > 0 ? picked.slice(0, limit) : picked,
  }
}
