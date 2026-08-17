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
import { type DatabaseSync } from './sqlite.ts'

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

// What comes back out. A run of identical errors reads as ONE row carrying the
// cohort's count and span (see recent()); the extra fields are absent on a lone
// row, so an uncollapsed log is unchanged.
export type Log = {
  ts: string
  source: string
  name: string
  session_id: string | null
  ok: number
  ms: number | null
  error: string | null
  detail: string | null
  count?: number // occurrences in this cohort (> 1)
  first?: string // ts of the oldest occurrence
  last?: string // ts of the newest (the represented row)
}

// Free text arrives from stack traces and tool output — long enough to
// bloat the table, never long enough to be worth it past the first screen.
let CAP = 2048
let clip = (s: string) => s.length > CAP ? s.slice(0, CAP - 1) + '…' : s

// This log is served at /telemetry and this repo is public, so free text is
// cleaned on the way IN — not a denylist chased pattern by pattern, but a fixed
// set of shapes that carry secrets or defeat cohorting: control bytes, home
// paths, URLs, and high-entropy tokens (uuids, long hex, long opaque runs). The
// same normalization does double duty — it strips the variable bits that would
// otherwise fingerprint two identical crashes apart (see fingerprint()). Capped
// last, so the stored field is bounded whatever survived.
let scrub = (s: string | null | undefined): string | null =>
  s == null ? null : clip(
    s
      // deno-lint-ignore no-control-regex -- strip C0/DEL, keep \t and \n
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
      .replace(/(?:\/home\/|\/Users\/)[^/\s:]+/g, '~')
      .replace(/\b[a-z][\w+.-]*:\/\/[^\s'")\]]+/gi, '«url»')
      .replace(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
        '«id»',
      )
      .replace(/\b(?:0x)?[0-9a-f]{16,}\b/gi, '«hex»')
      .replace(/[A-Za-z0-9_-]{24,}/g, '«token»'),
  )

// A record() that observes its own append failure turns one broken call into a
// loop; the guard makes the pipeline blind to itself, so a re-entrant record
// (a future sink logging its own fault) is dropped, not chased.
let inside = false

export let record = (db: DatabaseSync, c: Call) => {
  if (inside) return
  inside = true
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
      scrub(c.error),
      scrub(c.detail),
    )
  } catch (e) {
    console.warn('telemetry: row dropped —', e)
  } finally {
    inside = false
  }
}

// A deterministic cohort key for an error: its CLASS and door and the SHAPE of
// its top stack frames — never the variable message, which carries the one
// value that differs run to run. Identical crashes share a key; N copies of the
// same rendering bug collapse to "47×", which is both smaller and more useful
// than a wall of the same line. Frames drop their line:col so a rebuild that
// shifts every line still cohorts. Messages are already path/url/token-scrubbed
// on write, so the fallback (an error with no class or frames) still matches.
let errClass = (error: string) => {
  let head = error.split('\n', 1)[0]
  return head.match(/[\w.$]*(?:Error|Exception)\b/)?.[0] ?? ''
}

let frames = (detail: string | null) =>
  (detail ?? '')
    .split('\n')
    .filter((l) => /\bat\b|@/.test(l))
    .slice(0, 5)
    .map((l) => l.replace(/:\d+:\d+/g, '').trim())
    .join('|')

let fingerprint = (r: Log) => {
  let cls = errClass(r.error ?? '')
  let fr = frames(r.detail)
  let body = cls || fr ? `${cls}\n${fr}` : (r.error ?? '').split('\n', 1)[0]
  return `${r.source}\n${r.name}\n${body}`
}

// Collapse repeated ERRORS into one counted cohort; successful calls pass
// through untouched — each timed call is its own datum, which is what stats()
// reads. Rows arrive newest-first, so the first sighting of a key is the
// cohort's `last` and every later sighting walks `first` back in time. A lone
// error keeps count 1 and sheds the extra fields, so an uncollapsed log is
// byte-identical to before.
let cohort = (rows: Log[]): Log[] => {
  let seen = new Map<string, Log>()
  let out: Log[] = []
  for (let r of rows) {
    if (r.ok) {
      out.push(r)
      continue
    }
    let hit = seen.get(fingerprint(r))
    if (hit) {
      hit.count = (hit.count ?? 1) + 1
      hit.first = r.ts
    } else {
      let rep = { ...r, count: 1, first: r.ts, last: r.ts }
      seen.set(fingerprint(r), rep)
      out.push(rep)
    }
  }
  for (let r of out) {
    if (r.count == 1) {
      delete r.count
      delete r.first
      delete r.last
    }
  }
  return out
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
  // Pull the wide window (the hard cap) and cohort in memory, so a crash's
  // count is right even when its copies outnumber the page; then slice to n.
  // rowid breaks ts ties — two calls can share a millisecond, and the later one
  // is still later.
  let rows = db.prepare(`
    select ts, source, name, session_id, ok, ms, error, detail from tool_call
    ${where.length ? `where ${where.join(' and ')}` : ''}
    order by ts desc, rowid desc limit 500
  `).all(...args) as Log[]
  return cohort(rows).slice(0, n)
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
