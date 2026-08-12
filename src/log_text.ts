// A session's log as readable TEXT: the one place a normalized LogRow
// (types.ts) becomes a line, shared by session_peek's clipped glance and the
// whole `transcript` door. It reads nothing — callers hand it rows already
// rendered by the process-backed adapters or the graph-native entry_log.
//
// A rowless entry is provider machinery the renderer OMITS — the same call
// Session.tsx's SessionBody makes: a JSON line the adapter chose not to
// normalize is bookkeeping, not a chat item. The one exception is a line that
// is not JSON at all: raw bytes are evidence of a broken stream and stay
// visible. This is what keeps a graph-native peek from dumping an entry's raw
// `{"eid":…,"seq":…}` JSON mid-transcript when shown() had nothing to say.
import { type LogRow } from './types.ts'

export type LogEntry = { seq: number; line: string; row?: LogRow }

// A rowless line is a chat item only when it is NOT structured machinery: the
// adapter emits JSON it left un-normalized (hide it), or a provider prints raw
// bytes over its own stream (show them). Mirrors Session.tsx `bareType`.
let machinery = (line: string) => {
  try {
    JSON.parse(line)
    return true
  } catch {
    return false
  }
}

// One row as a single line. `width` bounds long values: a peek passes a small
// number for a glance (whitespace collapsed to one terminal line); a transcript
// passes Infinity to keep whole prose and its own line breaks.
export let renderRow = (r: LogRow, width = Infinity): string => {
  let clip = (s: unknown) => {
    let v = String(s ?? '')
    if (!Number.isFinite(width)) return v.trim()
    let one = v.replace(/\s+/g, ' ').trim()
    return one.length > width ? one.slice(0, width) : one
  }
  return r.kind == 'say'
    ? `${r.role}: ${clip(r.text)}`
    : r.kind == 'reason'
    ? `… ${clip(r.text)}`
    : r.kind == 'exec'
    ? `$ ${clip(r.command)}`
    : r.kind == 'tool'
    ? `[${r.name}] ${clip(r.error ?? r.detail ?? '')}`
    : r.kind == 'turn'
    ? `— turn —${r.model ? ` ${clip(r.model)}` : ''}`
    : r.kind == 'error'
    ? `ERROR ${clip(r.text)}`
    : r.kind == 'sys'
    ? `(${clip(r.tag)}${r.text ? ` ${clip(r.text)}` : ''})`
    : `(${(r as { kind: string }).kind})`
}

// One entry as a seq-gutter-prefixed line, or undefined when it carries nothing
// to show (machinery). `width` flows to renderRow; a rowless non-JSON line is
// shown as its own bytes, clipped the same way.
export let renderEntry = (
  e: LogEntry,
  width = Infinity,
): string | undefined => {
  let said = e.row
    ? renderRow(e.row, width)
    : machinery(e.line)
    ? undefined
    : Number.isFinite(width)
    ? e.line.replace(/\s+/g, ' ').trim().slice(0, width)
    : e.line.trim()
  return said == null ? undefined : `${String(e.seq).padStart(4)}  ${said}`
}

// The kinds that count as PROSE — what was said and thought, not the machinery
// of tool calls, results and turn boundaries. `--prose` keeps only these.
let PROSE = new Set(['say', 'reason'])

export type Sift = {
  from?: number // seq >= from
  to?: number // seq <= to
  prose?: boolean // say + reason only
  since?: string // created.at >= since (ISO)
  until?: string // created.at <= until (ISO)
}

// "40..80" → inclusive seq bounds; either end may be omitted (`40..`, `..80`).
// The one spelling the CLI flag and the MCP arg both parse, so the range means
// the same thing at every door.
export let seqRange = (s: string): { from?: number; to?: number } => {
  let m = s.match(/^(\d+)?\.\.(\d+)?$/)
  if (!m || (!m[1] && !m[2])) {
    throw new Error(`not a seq range: ${s} (try 40..80)`)
  }
  return {
    ...(m[1] ? { from: Number(m[1]) } : {}),
    ...(m[2] ? { to: Number(m[2]) } : {}),
  }
}

// The whole (or sifted) partition as clean transcript lines: rowless machinery
// dropped, each surviving entry a line via renderEntry at full width. Pure over
// already-fetched entries — paging (after/limit) belongs to the fetch that
// produced them, so this only screens what to SHOW and renders it.
export let transcribe = (entries: LogEntry[], sift: Sift = {}): string[] =>
  entries
    .filter((e) => {
      if (sift.from != null && e.seq < sift.from) return false
      if (sift.to != null && e.seq > sift.to) return false
      if (sift.prose && !(e.row && PROSE.has(e.row.kind))) return false
      let at = e.row?.at
      if (sift.since && (at == null || at < sift.since)) return false
      if (sift.until && (at == null || at > sift.until)) return false
      return true
    })
    .flatMap((e) => {
      let line = renderEntry(e)
      return line == null ? [] : [line]
    })
