// What the tools are actually doing: every MCP tool call, HTTP write,
// browser crash, and background sync that couldn't land in `tool_call` —
// who called what, how long it took, whether it worked. That's the
// feedback loop for tool ergonomics: the errors agents hit are the docs we
// haven't written yet, and the errors nobody hits are the ones that decay
// into a hand repair six months on.
//
// Deliberately OUTSIDE the graph. This is verbose log data, not entities:
// the table isn't in the `comps` vocabulary, so snapshot() never walks it
// and no client cache ever carries it. Rows accrete; nothing links them.
//
// Recording is best-effort BY CONTRACT — a telemetry failure must never
// break the thing it watches, so record() swallows and warns. SERVER-ONLY.
import { type DatabaseSync } from 'node:sqlite'

// What a caller reports. `ok` is the only judgement: a tool that answered
// with an error is a call that happened AND failed — both facts matter.
// `srv` is the server's own background work (the persona sync): no caller
// to disappoint, but the same question — what failed, when, and why.
export type Call = {
  source: 'mcp' | 'http' | 'web' | 'srv' | 'cli'
  name: string
  session_id?: string | null
  ok: boolean
  ms?: number | null
  error?: string | null
  detail?: string | null
}

// What comes back out.
export type Log = {
  ts: string
  source: string
  name: string
  session_id: string | null
  ok: number
  ms: number | null
  error: string | null
  detail: string | null
}

// Free text arrives from stack traces and tool output — long enough to
// bloat the table, never long enough to be worth it past the first screen.
let CAP = 2048
let clip = (s: string | null | undefined) =>
  s == null ? null : s.length > CAP ? s.slice(0, CAP - 1) + '…' : s

export let record = (db: DatabaseSync, c: Call) => {
  try {
    db.prepare(`
      insert into tool_call (source, name, session_id, ok, ms, error, detail)
      values (?, ?, ?, ?, ?, ?, ?)
    `).run(
      c.source,
      c.name,
      c.session_id ?? null,
      Number(c.ok),
      c.ms == null ? null : Math.round(c.ms),
      clip(c.error),
      clip(c.detail),
    )
  } catch (e) {
    console.warn('telemetry: row dropped —', e)
  }
}

// Newest first. `only=errors` is the view you actually want most days.
// The limit clamps: this is a debugging door, not a bulk export.
export let recent = (
  db: DatabaseSync,
  { since, limit, only }: { since?: string; limit?: number; only?: string } =
    {},
): Log[] => {
  let n = Math.min(Math.max(Math.trunc(Number(limit)) || 50, 1), 500)
  let where: string[] = []
  let args: string[] = []
  if (since) {
    where.push('ts >= ?')
    args.push(since)
  }
  if (only == 'errors') where.push('ok = 0')
  // rowid breaks ts ties — two calls can share a millisecond, and the
  // later one is still later.
  return db.prepare(`
    select ts, source, name, session_id, ok, ms, error, detail from tool_call
    ${where.length ? `where ${where.join(' and ')}` : ''}
    order by ts desc, rowid desc limit ?
  `).all(...args, n) as Log[]
}

// Latency distribution, computed in SQL (T-16327). Per (source, name) — the
// door and the tool — the count of TIMED calls and the p50/p95/p99 of their
// duration in ms, so a slow tool shows itself without pulling every row into
// JS. SQLite's own percentile_cont (3.53+) skips nulls, so an untimed call
// (ms null) never counts; the same since/only filters recent() takes screen
// the rows, busiest group first.
export type Stat = {
  source: string
  name: string
  n: number
  p50: number
  p95: number
  p99: number
}

export let stats = (
  db: DatabaseSync,
  { since, only }: { since?: string; only?: string } = {},
): Stat[] => {
  let where = ['ms is not null']
  let args: string[] = []
  if (since) {
    where.push('ts >= ?')
    args.push(since)
  }
  if (only == 'errors') where.push('ok = 0')
  return db.prepare(`
    select source, name, count(*) as n,
      round(percentile_cont(ms, 0.5), 1) as p50,
      round(percentile_cont(ms, 0.95), 1) as p95,
      round(percentile_cont(ms, 0.99), 1) as p99
    from tool_call
    where ${where.join(' and ')}
    group by source, name
    order by n desc
  `).all(...args) as unknown as Stat[]
}

// The /mcp body, classified. A tools/call is the interesting traffic —
// which tool, whose session (agents pass `session` to the task_* tier).
// initialize and tools/list are handshake noise; they record nothing.
export let toolCall = (body: unknown) => {
  let b = body as {
    method?: string
    params?: { name?: string; arguments?: { session?: string } }
  }
  if (b?.method != 'tools/call' || !b.params?.name) return null
  return {
    name: String(b.params.name),
    session_id: b.params.arguments?.session ?? null,
  }
}

// A JSON-RPC reply read as an outcome. Two shapes mean failure: a
// protocol error (bad params, unknown tool) and an isError result (the
// tool ran and refused) — from the agent's seat those are the same
// disappointment, so they count the same. The first text block is the
// message worth keeping.
export let outcome = (reply: unknown) => {
  let r = reply as {
    error?: { message?: string }
    result?: { isError?: boolean; content?: { type?: string; text?: string }[] }
  }
  if (r?.error) return { ok: false, error: r.error.message ?? 'jsonrpc error' }
  if (r?.result?.isError) {
    let text = r.result.content?.find((c) => c.type == 'text')?.text
    return { ok: false, error: text || 'tool error' }
  }
  return { ok: true, error: null }
}
