// The headless client half — what the CLI and the MCP server share. Talks
// to a running tasks server over HTTP (/snapshot to read, /apply to
// write; writes broadcast to every live client), assembles entities the
// same way live.ts does, and owns the dot-param grammar:
//   .title=Hello        routes by prop — title lives only in doc
//   .doc.title=Hello    the explicit spelling, for collisions (pin/camera
//                       geometry) or clarity
// Values that look like numbers become numbers.
import {
  type Change,
  comps,
  type Dep,
  type Hit,
  kindOf,
  type Snapshot,
  statuses,
} from './types.ts'
import { idOf } from './types.ts'
import { routeProp } from './query.ts'
export { idOf }

export let host = () => Deno.env.get('TASKS_HOST') ?? '127.0.0.1:5173'

export type Row = {
  eid: string
  num: number
  kind: string
  comps: Record<string, Record<string, unknown>>
}

export let snapshot = async () => {
  let res = await fetch(`http://${host()}/snapshot`)
  if (!res.ok) throw new Error(`server said ${res.status}`)
  return res.json() as Promise<{ changes: Change[]; deps: Dep[] }>
}

// The graph as rows: one per entity, components merged in; kind derived.
export let rows = ({ changes }: { changes: Change[] }) => {
  let out = new Map<string, Row>()
  for (let { eid, name, comp } of changes) {
    if (!comp) continue
    let row = out.get(eid) ??
      { eid, num: 0, kind: 'entity', comps: {} }
    if (name == 'entity') row.num = Number(comp.num ?? 0)
    row.comps[name] = comp // entity rides too: created_at/modified_at
    out.set(eid, row)
  }
  for (let r of out.values()) r.kind = kindOf(r.comps)
  return [...out.values()]
}

// Full-text search, server-side (FTS5) — the graph's docs, ranked.
export let search = async (q: string, limit = 20) => {
  let res = await fetch(
    `http://${host()}/search?q=${encodeURIComponent(q)}&limit=${limit}`,
  )
  if (!res.ok) throw new Error(`server said ${res.status}`)
  return res.json() as Promise<Hit[]>
}

export let send = async (changes: Change[]) => {
  let res = await fetch(`http://${host()}/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(changes),
  })
  if (!res.ok) throw new Error(`apply failed: ${await res.text()}`)
}

// ---- dot-params (the WRITE grammar: values are literal; the filter
// grammar with operators/lists/ranges lives in query.ts) ----

export type Param = { comp: string; prop: string; value: unknown }

let coerce = (v: string): unknown => /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v

// '.title=Hello' | '.doc.title=Hello' → {comp, prop, value}; null if the
// argument isn't a dot-param at all (a bare word).
export let param = (arg: string): Param | null => {
  let m = arg.match(/^\.([A-Za-z_]+)(?:\.([A-Za-z_]+))?=(.*)$/s)
  if (!m) return null
  let [, a, b, raw] = m
  let value = coerce(raw)
  if (b) {
    if (!comps[a]?.includes(b)) {
      throw new Error(`no such prop: .${a}.${b}`)
    }
    return { comp: a, prop: b, value }
  }
  return { comp: routeProp(a), prop: a, value }
}

// Group routed params into per-component patches.
export let patches = (params: Param[]) => {
  let out: Record<string, Record<string, unknown>> = {}
  for (let { comp, prop, value } of params) {
    ;(out[comp] ??= {})[prop] = value
  }
  return out
}

// The standard task-create batch: a doc face, workflow state, then any
// other grouped components verbatim. Callers put title/body into
// grouped.doc first.
export let taskChanges = (
  eid: string,
  grouped: Record<string, Record<string, unknown>>,
): Change[] => [
  { eid, name: 'doc', comp: { body: '', ...grouped.doc } },
  { eid, name: 'task', comp: { status: 'open', ...grouped.task } },
  ...Object.entries(grouped)
    .filter(([n]) => n != 'doc' && n != 'task')
    .map(([name, comp]) => ({ eid, name, comp })),
]

// Resolve 'T-3' / a bare num / an eid to a row.
export let find = (all: Row[], id: string) => {
  let m = id.match(/^[A-Za-z]+-(\d+)$/) ?? id.match(/^(\d+)$/)
  if (m) return all.find((r) => r.num == +m![1])
  return all.find((r) => r.eid == id) ??
    all.find((r) => r.comps.alias?.slug == id)
}

// The board sort: status column order, then priority, then num.
export let byBoard = (a: Row, b: Row) =>
  (statuses.indexOf(String(a.comps.task?.status)) -
    statuses.indexOf(String(b.comps.task?.status))) ||
  (Number(a.comps.task?.priority ?? 0) - Number(b.comps.task?.priority ?? 0)) ||
  (a.num - b.num)

// Find-or-mint the session entity for an external session id: its eid
// plus the change that creates it when it's new.
export let sessionFor = (all: Row[], session: string, cwd?: string) => {
  let s = all.find((r) => r.comps.session && r.comps.session.id == session)
  let eid = s?.eid ?? crypto.randomUUID()
  let changes: Change[] = s
    ? (cwd && s.comps.session.cwd != cwd
      ? [{ eid, name: 'session', comp: { cwd } }]
      : [])
    : [{ eid, name: 'session', comp: { id: session, ...(cwd ? { cwd } : {}) } }]
  return { eid, changes }
}

// The claim pointing at a session entity — one batch, atomic on the server.
export let claimChanges = (
  all: Row[],
  target: string,
  session: string,
  cwd?: string,
): Change[] => {
  let s = sessionFor(all, session, cwd)
  return [
    ...s.changes,
    { eid: target, name: 'claim', comp: { session_eid: s.eid } },
  ]
}

// A comment: a doc aimed at the target, attributed to a session when
// one is named.
export let commentChanges = (
  all: Row[],
  target: string,
  body: string,
  session?: string,
): Change[] => {
  let s = session ? sessionFor(all, session) : undefined
  let eid = crypto.randomUUID()
  return [
    ...(s?.changes ?? []),
    { eid, name: 'doc', comp: { title: '', body } },
    {
      eid,
      name: 'comment',
      comp: { target_eid: target, author_eid: s?.eid ?? null },
    },
  ]
}

// The injection-loop digest: what a session sees at start — its claimed
// work (with unresolved gates and who holds them), or the top of the open
// board when it holds nothing. ≤20 lines by construction: the tracker
// stays out of the way, it just makes the working set impossible to lose.
export let contextDigest = (snap: Snapshot, session: string) => {
  let all = rows(snap)
  let byEid = new Map(all.map((r) => [r.eid, r]))
  let sess = all.find((r) =>
    r.comps.session && String(r.comps.session.id) == session
  )
  let mine = sess
    ? all.filter((r) => r.comps.claim?.session_eid == sess.eid)
    : []
  let lines = [`tasks · session ${session}`]
  let show = (r: Row) => {
    lines.push(
      `  ${idOf(r)} ${String(r.comps.task?.status ?? r.kind).padEnd(5)} ${
        r.comps.doc?.title ?? ''
      }`,
    )
    for (let d of snap.deps.filter((d) => d.parent == r.eid)) {
      let c = byEid.get(d.child)
      if (!c || d.type == 'reads') continue
      if (String(c.comps.task?.status) == 'done') continue
      let who = claimant(all, c)
      lines.push(
        `    ${d.type} → ${idOf(c)} (${c.comps.task?.status ?? c.kind}${
          who ? `, ⚑ ${who}` : ''
        })`,
      )
    }
  }
  if (mine.length) {
    lines.push('claimed by you:')
    mine.slice(0, 4).forEach(show)
  } else {
    lines.push('nothing claimed. open work, board order:')
    all.filter((r) => r.comps.task && r.comps.task.status != 'done')
      .filter((r) => !r.comps.claim)
      .sort(byBoard).slice(0, 5).forEach(show)
  }
  lines.push(
    `claim: task claim <id> ${session} · comment: task comment <id> "…" · release when done or handing off`,
  )
  return lines.slice(0, 20).join('\n')
}

// The lapse batch: a session ended — release every claim it holds, and
// on tasks it did NOT finish, leave a comment saying so (the simple
// audit: no timers, no heartbeats, just "ended before done" on the
// record). Finished work releases silently.
export let lapseChanges = (all: Row[], session: string): Change[] => {
  let sess = all.find((r) =>
    r.comps.session && String(r.comps.session.id) == session
  )
  if (!sess) return []
  let held = all.filter((r) => r.comps.claim?.session_eid == sess.eid)
  return held.flatMap((r) => [
    ...(String(r.comps.task?.status) == 'done' ? [] : commentChanges(
      all,
      r.eid,
      '⚑ lease lapsed: session `' + session + '` ended before this was done',
      session,
    ).slice(-2)), // the session exists — skip the mint, keep doc + comment
    { eid: r.eid, name: 'claim', comp: null },
  ])
}

// The claimant's session id, resolved through the claim's session entity.
export let claimant = (all: Row[], r: Row) => {
  let seid = r.comps.claim?.session_eid
  if (!seid) return undefined
  let s = all.find((x) => x.eid == seid)
  return String(s?.comps.session?.id ?? seid)
}
