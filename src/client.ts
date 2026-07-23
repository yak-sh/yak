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
  settled,
  type Snapshot,
  stamped,
  statuses,
  uuid,
} from './types.ts'
import { idOf } from './types.ts'
import { hot, matchQuery, type Pred, route, warm } from './query.ts'
import { unmime } from './rfc2047.ts'
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

// The CLI's standing identity: Claude's own session id first —
// CLAUDE_CODE_SESSION_ID rotates on /clear, so it always names the session
// actually speaking — then the launcher's TASKS_SESSION (managed non-claude
// spawns: codex/fake, whose harness sets no id of its own). The env lookup
// is injectable so the precedence is testable without mutating the process.
export let me = (
  env: (k: string) => string | undefined = (k) => Deno.env.get(k),
) => env('CLAUDE_CODE_SESSION_ID') ?? env('TASKS_SESSION')

// Writes carry WHO when the caller knows: the x-actor header lands in
// the server's journal (attribution, never auth). The CLI's standing
// identity is me() — hooks and spawned agents get their writes
// attributed without asking.
export let send = async (changes: Change[], actor = me()) => {
  let res = await fetch(`http://${host()}/apply`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(actor ? { 'x-actor': actor } : {}),
    },
    body: JSON.stringify(changes),
  })
  if (!res.ok) throw new Error(`apply failed: ${await res.text()}`)
}

// A value starting with @ is a FILE read by the tool itself — the safe
// door for long bodies. Shell substitution offers the same and fails
// silently ($(cat) in a zsh pipeline reads nothing, and an empty value
// CLEARS the column — this wiped four session briefs, 2026-07-22); a
// missing file here is a loud error instead. Literal leading @: @@.
export let inflate = (p: Param): Param => {
  let v = p.value
  if (typeof v != 'string' || !v.startsWith('@')) return p
  if (v.startsWith('@@')) return { ...p, value: v.slice(1) }
  try {
    return { ...p, value: Deno.readTextFileSync(v.slice(1)) }
  } catch {
    throw new Error(`.${p.prop}=@: no such file: ${v.slice(1)}`)
  }
}

// An entity's slice of the journal — the wire's record, newest first.
export type JournalEntry = {
  ts: string
  actor: string | null
  changes: Change[]
}
export let history = async (eid: string, limit = 50) => {
  let res = await fetch(`http://${host()}/journal?eid=${eid}&limit=${limit}`)
  if (!res.ok) throw new Error(`server said ${res.status}`)
  return res.json() as Promise<JournalEntry[]>
}

export let historyBy = async (actor: string, limit = 500) => {
  let res = await fetch(
    `http://${host()}/journal?actor=${
      encodeURIComponent(actor)
    }&limit=${limit}`,
  )
  if (!res.ok) throw new Error(`server said ${res.status}`)
  return res.json() as Promise<JournalEntry[]>
}

// The session's day, told from the wire's own record — no model, no
// recollection, just the journal grouped into sentences. Pure: entries
// arrive newest-first (as the server serves them), `all` only humanizes
// ids; a dead endpoint falls back to a short eid rather than lying.
export let ledger = (entries: JournalEntry[], all: Row[]): string[] => {
  if (!entries.length) return []
  let byEid = new Map(all.map((r) => [r.eid, r]))
  let cut = (s: unknown, n = 72) => {
    let t = String(s ?? '').split('\n')[0].trim()
    return t.length > n ? t.slice(0, n - 1) + '…' : t
  }
  let name = (eid: unknown) => {
    let r = byEid.get(String(eid))
    return r
      ? `${idOf(r)} ${cut(r.comps.doc?.title ?? r.comps.session?.id ?? '', 48)}`
        .trim()
      : String(eid).slice(0, 8)
  }
  let lines: string[] = []
  for (let e of [...entries].reverse()) { // oldest first: the day as lived
    let minted = new Set(
      e.changes.filter((c) => c.name == 'entity' && c.comp?.num != null)
        .map((c) => c.eid),
    )
    let seen = new Set<string>() // eids already said this batch
    for (let c of e.changes) {
      if (c.name == 'entity' && c.comp == null) {
        lines.push(`- × deleted ${name(c.eid)}`)
        seen.add(c.eid)
      }
    }
    for (let eid of minted) {
      if (seen.has(eid)) continue
      let comps = Object.fromEntries(
        e.changes.filter((c) => c.eid == eid && c.comp).map(
          (c) => [c.name, c.comp!],
        ),
      )
      if (comps.comment) {
        let first = cut(comps.doc?.body)
        lines.push(
          `- 💬 on ${name(comps.comment.target_eid)}${
            first ? `: ${first}` : ''
          }`,
        )
      } else {
        lines.push(
          `- + minted ${kindOf(comps)} ${name(eid)}`,
        )
      }
      seen.add(eid)
    }
    for (let c of e.changes) {
      if (seen.has(c.eid) && c.name != 'dependency') continue
      if (c.name == 'claim') {
        lines.push(
          c.comp == null
            ? `- ⚐ released ${name(c.eid)}`
            : `- ⚑ claimed ${name(c.eid)}`,
        )
        seen.add(c.eid)
      } else if (c.name == 'task' && c.comp && 'status' in c.comp) {
        // a same-batch reason comment (the journal pseudo-change's twin)
        // already tells the story as its own 💬 line
        lines.push(`- → ${name(c.eid)} status → ${c.comp.status}`)
        seen.add(c.eid)
      } else if (c.name == 'dependency' && c.comp) {
        let verb = c.comp.gone ? 'unlinked' : 'linked'
        lines.push(
          `- ∴ ${verb} ${name(c.eid)} ${c.comp.type} ${name(c.comp.child_eid)}`,
        )
      } else if (c.comp && c.name != 'entity' && c.name != 'journal') {
        let cols = Object.keys(c.comp).filter((k) => k != 'eid').join(' ')
        lines.push(`- · ${c.name}{${cols}} on ${name(c.eid)}`)
        seen.add(c.eid)
      }
    }
  }
  let span = `${entries[entries.length - 1].ts} → ${
    entries[0].ts
  } · ${entries.length} batch(es)`
  return [span, '', ...lines]
}

// One journal entry as a line: when · who · what. The patch is said
// compactly — comp{cols} for writes, -comp for removals, † for the
// entity's death — enough to scan a trail without reading JSON.
export let historyLine = (e: JournalEntry) => {
  let what = e.changes.map((c) =>
    c.comp == null
      ? c.name == 'entity' ? '†' : `-${c.name}`
      : `${c.name}{${Object.keys(c.comp).filter((k) => k != 'eid').join(' ')}}`
  ).join(' · ')
  return `${e.ts}  ${(e.actor ?? 'unknown').slice(0, 24).padEnd(24)} ${what}`
}

// ---- dot-params (the WRITE grammar: values are literal; the filter
// grammar with operators/lists/ranges lives in query.ts) ----

export type Param = { comp: string; prop: string; value: unknown }

let coerce = (v: string): unknown => /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v

// '.title=Hello' | '.doc.title=Hello' → {comp, prop, value}; null if the
// argument isn't a dot-param at all (a bare word). Bare props ride
// query.ts route(), so the reference sugar holds for writes too:
// '.assignee=jeff' patches task.assignee_eid (derefParams turns the
// value into an eid at the door).
export let param = (arg: string): Param | null => {
  let m = arg.match(/^\.([A-Za-z_]+)(?:\.([A-Za-z_]+))?=(.*)$/s)
  if (!m) return null
  let [, a, b, raw] = m
  let value = coerce(raw)
  if (b) {
    if (!(b in (comps[a] ?? {}))) {
      throw new Error(`no such prop: .${a}.${b}`)
    }
    return { comp: a, prop: b, value }
  }
  let r = route(a)
  // route()'s any-of ('' comp) serves FILTERS; a write must aim at one
  // component, so demand the explicit spelling.
  if (!r.comp) {
    let owners = Object.keys(comps).filter((c) => r.prop in comps[c])
    throw new Error(
      `.${a} is ambiguous for writes (${
        owners.join(', ')
      }) — use .comp.${r.prop}`,
    )
  }
  return { ...r, value }
}

// Reference values at a door: uuids pass through, '' clears, anything
// else must resolve — an alias (jeff), a human id (T-3), a bare num — or
// the door throws, never a silent FK failure later. One resolver for
// every write door (CLI, MCP task_new/update, graph_apply values).
let UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export let deref = (all: Row[], v: string, where = '') => {
  if (!v || UUID.test(v)) return v
  let hit = find(all, v)
  if (!hit) throw new Error(`no entity: ${v}${where}`)
  return hit.eid
}
export let derefParams = (all: Row[], ps: Param[]) =>
  ps.map((p) =>
    p.prop.endsWith('_eid') &&
      (typeof p.value == 'string' || typeof p.value == 'number')
      ? { ...p, value: deref(all, String(p.value), ` (.${p.prop})`) }
      : p
  )

// Group routed params into per-component patches.
export let patches = (params: Param[]) => {
  let out: Record<string, Record<string, unknown>> = {}
  for (let { comp, prop, value } of params) {
    ;(out[comp] ??= {})[prop] = value
  }
  return out
}

// A task, TYPED: 'P1 .domain=Eng Build a thing\nnotes…' — the first line
// is setters + title, every later line is body. Dot-params parse
// anywhere in the line (their syntax can't be prose); the P1 shorthand
// only parses while it LEADS, so a title like 'Fix the P2 endpoint'
// keeps its words. One parser for every door that takes a typed task —
// the board's quick-add, :new, whatever comes next. A malformed
// dot-param stays a word rather than throwing: mid-typing is not an
// error, and Enter files what the preview showed.
export let spec = (text: string) => {
  let [line, ...rest] = text.split('\n')
  let words: string[] = []
  let ps: Param[] = []
  let leading = true
  for (let w of line.trim().split(/\s+/).filter(Boolean)) {
    let p = leading && w.match(/^[Pp](\d+(\.\d+)?)$/)
    if (p) {
      ps.push({ comp: 'task', prop: 'priority', value: Number(p[1]) })
      continue
    }
    if (w.startsWith('.')) {
      try {
        let d = param(w)
        if (d) {
          ps.push(d)
          continue
        }
      } catch { /* not a real prop: a word after all */ }
    }
    leading = false
    words.push(w)
  }
  return {
    title: words.join(' '),
    body: rest.join('\n').trim(),
    grouped: patches(ps),
  }
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
// plus the change that creates or refreshes it. cwd is where it runs; pid
// is the claude process it runs IN (the SessionStart hook walks /proc for
// it) — the anchor that lets the channel plugin follow a /clear rotation,
// when a NEW session id reifies under the same process.
export let sessionFor = (
  all: Row[],
  session: string,
  cwd?: string,
  pid?: number,
) => {
  let s = all.find((r) => r.comps.session && r.comps.session.id == session)
  let eid = s?.eid ?? uuid()
  let comp: Record<string, unknown> = s ? {} : { id: session }
  if (cwd && s?.comps.session.cwd != cwd) comp.cwd = cwd
  if (pid && s?.comps.session.pid != pid) comp.pid = pid
  let changes: Change[] = Object.keys(comp).length
    ? [{ eid, name: 'session', comp }]
    : []
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

// What a spawn inherits when the caller doesn't say: the CALLING
// session's own provider and model — a managed caller always has both,
// an external one has whatever it announced. The provider-table default
// lives at the doors (they can reach /providers; this builder can't).
export let spawnDefaults = (all: Row[], session?: string) => {
  let s = session
    ? all.find((r) => r.comps.session && String(r.comps.session.id) == session)
      ?.comps.session
    : undefined
  return {
    provider: s?.provider ? String(s.provider) : undefined,
    model: s?.model ? String(s.model) : undefined,
  }
}

// The spawn batch: one session entity carrying the request columns —
// the server's created(session) effect validates and launches it, and
// every way it can fail lands as a failed Session on the board, not an
// error here. The task (and persona) resolve through find(), so human
// ids work everywhere.
export let spawnChanges = (
  all: Row[],
  s: {
    task: string
    provider: string
    model: string
    effort?: string
    persona?: string
    by?: string
    deps?: Dep[]
  },
) => {
  let task = find(all, s.task)
  if (!task?.comps.task) throw new Error(`no task: ${s.task}`)
  let persona = s.persona ? find(all, s.persona) : undefined
  if (s.persona && !persona) throw new Error(`no entity: ${s.persona}`)
  // Behalf is a CHOICE, not plumbing: wearing a persona owned by an
  // operator means acting AS that operator, so the spawn's actor is the
  // persona's owner; otherwise the child inherits the caller's actor —
  // delegation doesn't launder identity. Ownership is an edge in either
  // spelling (persona about owner, or owner contains persona) to an
  // entity that IS an actor (person or project).
  let owner = persona &&
    (s.deps ?? []).map((d) =>
      d.type == 'about' && d.parent == persona.eid
        ? d.child
        : d.type == 'contains' && d.child == persona.eid
        ? d.parent
        : undefined
    ).map((eid) => eid ? find(all, eid) : undefined)
      .find((r) => r?.comps.person || r?.comps.project)
  let caller = s.by
    ? all.find((r) => String(r.comps.session?.id) == s.by)?.comps.session
    : undefined
  let actor = owner?.eid ?? caller?.actor_eid
  let eid = uuid()
  let changes: Change[] = [{
    eid,
    name: 'session',
    comp: {
      id: uuid(),
      provider: s.provider,
      model: s.model,
      ...(s.effort ? { effort: s.effort } : {}),
      requested_task_eid: task.eid,
      ...(persona ? { persona_eid: persona.eid } : {}),
      ...(actor ? { actor_eid: actor } : {}),
    },
  }]
  return { eid, changes }
}

// The hook's auto-claim: a managed spawn boots already holding its lease
// (the launcher passes TASKS_TASK). Only an unclaimed task claims — a
// held lease is news for the digest, never a fight. [] when there is
// nothing to do.
export let hookClaim = (
  all: Row[],
  want: string | undefined,
  session: string,
  cwd?: string,
): Change[] => {
  if (!want) return []
  let task = find(all, want)
  if (!task?.comps.task || task.comps.claim) return []
  return claimChanges(all, task.eid, session, cwd)
}

// A comment: a doc aimed at the target, attributed to a session when
// one is named. `event` marks machinery speaking (M-4062) — a notice a
// command emits, not words an agent typed — so the mail relay skips it.
export let commentChanges = (
  all: Row[],
  target: string,
  body: string,
  session?: string,
  event?: boolean,
): Change[] => {
  let s = session ? sessionFor(all, session) : undefined
  let eid = uuid()
  return [
    ...(s?.changes ?? []),
    { eid, name: 'doc', comp: { title: '', body } },
    {
      eid,
      name: 'comment',
      comp: {
        target_eid: target,
        author_eid: s?.eid ?? null,
        ...(event ? { event: 1 } : {}),
      },
    },
  ]
}

// Unread mail: it ARRIVED (message_id is the inbound mark) and the
// reader's own read_at is still empty. Outbound rows carry no message_id,
// so they never count — sent mail is born read.
export let unreadMail = (r: Row) =>
  !!r.comps.mail?.message_id && !r.comps.mail.read_at

// The inbox — ONE scoping truth: the digest's unread count and the bare
// `task mail` view agree by construction. Unread, aimed at the scope
// when one stands; no scope sees the fleet's whole pile.
export let inboxMail = (scope?: string) => (r: Row) =>
  unreadMail(r) && (!scope || r.comps.mail?.target_eid == scope)

// The project you stand in: the repo-wearing entity whose path prefixes
// the cwd — every caller-aware door derives its scope this same way.
export let repoAt = (all: Row[], cwd?: string) =>
  cwd
    ? all.find((r) =>
      r.comps.repo?.path && cwd.startsWith(String(r.comps.repo.path))
    )
    : undefined

// When a mail happened, for sorting and ages: arrival for inbound, the
// entity's birth for outbound.
export let mailAt = (r: Row) =>
  String(r.comps.mail?.received_at ?? r.comps.entity?.created_at ?? '')

// The send batch: a mail is a document that travels — subject rides
// doc.title, the body doc.body. `to` stays AS GIVEN (a raw address or a
// graph reference) — the address book resolves at delivery, never here.
export let mailChanges = (m: {
  to: string
  subject: string
  body?: string
  from?: string
  replyTo?: string
}) => {
  let eid = uuid()
  let changes: Change[] = [
    { eid, name: 'doc', comp: { title: m.subject, body: m.body ?? '' } },
    {
      eid,
      name: 'mail',
      comp: {
        to: m.to,
        ...(m.from ? { from: m.from } : {}),
        ...(m.replyTo ? { reply_to_eid: m.replyTo } : {}),
      },
    },
  ]
  return { eid, changes }
}

// Re: derivation — shed however many Re:/Fwd: layers already piled up.
export let reSubject = (s: string) =>
  `Re: ${s.replace(/^(\s*(re|fwd?):\s*)+/i, '').trim()}`

// The reply batch: answer goes to the far side — an inbound row's
// sender, your own sent row's recipient — subject prefilled Re: …, and
// reply_to_eid records the thread at authoring (delivery resolves it).
export let replyChanges = (row: Row, body: string, from?: string) => {
  let m = row.comps.mail ?? {}
  return mailChanges({
    to: String((m.message_id ? m.from ?? m.to : m.to) ?? ''),
    subject: reSubject(String(row.comps.doc?.title ?? '')),
    body,
    from,
    replyTo: row.eid,
  })
}

// A mail's THREAD: ancestors up the reply_to_eid chain, descendants by
// growing the set with whatever answers it — chronological, the way a
// mail client shows one.
export let threadOf = (all: Row[], eid: string): Row[] => {
  let byEid = new Map(all.map((r) => [r.eid, r]))
  let seen = new Set<string>()
  for (let r = byEid.get(eid); r && !seen.has(r.eid);) {
    seen.add(r.eid)
    r = byEid.get(String(r.comps.mail?.reply_to_eid ?? ''))
  }
  for (let grew = true; grew;) {
    grew = false
    for (let r of all) {
      let p = String(r.comps.mail?.reply_to_eid ?? '')
      if (p && seen.has(p) && !seen.has(r.eid)) {
        seen.add(r.eid)
        grew = true
      }
    }
  }
  return all.filter((r) => seen.has(r.eid))
    .sort((a, b) => mailAt(a).localeCompare(mailAt(b)))
}

// One inbox line: id, the unread dot, who → whom, subject, age — with
// the unverified mark loud (unverified content is data, and the reader
// should know). Bolding is the terminal's concern, not this string's.
export let mailLine = (r: Row, now = Date.now()) => {
  let m = r.comps.mail ?? {}
  let dot = unreadMail(r) ? '●' : '·'
  let bad = m.message_id && !Number(m.verified ?? 0) ? ' !unverified' : ''
  let who = m.message_id
    ? `${String(m.from ?? '?')} → ${String(m.to)}`
    : `→ ${String(m.to_addr ?? m.to)}`
  let ms = now - Date.parse(mailAt(r))
  let mins = Math.floor(ms / 60_000)
  let age = Number.isNaN(ms) || ms < 0
    ? ''
    : mins < 60
    ? ` (${mins}m)`
    : mins < 1440
    ? ` (${Math.floor(mins / 60)}h)`
    : ` (${Math.floor(mins / 1440)}d)`
  let subj = unmime(String(r.comps.doc?.title ?? '(no subject)'))
  return `${idOf(r).padEnd(6)} ${dot}${bad} ${who} — ${subj}${age}`
}

// The LATELY tier: what the graph did today and this week, hot-ranked,
// so every session boots already knowing (T-3722 — the memory system's
// delivery half). Work-session docs — a session wearing a doc, the
// wake-brief pattern — lead today's list with their first body line; the
// rest are id + title, pointers a reader expands on demand. Memory index
// lines close it: recognition only, never a recall bump (index listings
// must not flatten the decay signal). Older than a week is search's job.
let DAY = 86_400_000
let firstLine = (s: unknown) =>
  String(s ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? ''
let snip = (s: string, n = 72) => s.length > n ? `${s.slice(0, n)}…` : s
// A scope narrows lately to what BELONGS to the project: its tasks, its
// memories (unscoped memories are principles — they always ride), its
// personas. What can't be classified stays — hiding the unclassifiable
// would make the digest lie by omission.
let belongs = (r: Row, scope?: string) => {
  if (!scope) return true
  if (r.comps.task) return r.comps.task.project_eid == scope
  if (r.comps.memory) {
    return !r.comps.memory.scope_eid || r.comps.memory.scope_eid == scope
  }
  if (r.comps.persona) return r.comps.persona.home_eid == scope
  if (r.comps.project) return r.eid == scope
  return true
}
// A session's brief: the doc body wrap captured or the operator wrote —
// a stub isn't one — falling back to the managed row's final_text.
let briefOf = (r: Row) => {
  let b = String(r.comps.doc?.body ?? '')
  if (b && !b.startsWith(STUB)) return b
  return String(r.comps.session?.final_text ?? '')
}
// Comments that landed on the actor's recent past sessions AFTER those
// sessions stopped listening — one digest line of history, never
// injected as conversation (a dead session's cursor stays frozen: it
// documents what that session never saw). "Recent" bounds the sweep to
// the actor's other sessions touched this week, newest five; "unseen"
// is the bus cursor's own definition — created after the session's
// last ack, or after its birth if it never acked. Machine events and
// the actor's own words don't count.
let unheard = (all: Row[], sess: Row | undefined, now: number) => {
  let actor = String(sess?.comps.session?.actor_eid ?? '')
  if (!actor) return []
  let byEid = new Map(all.map((r) => [r.eid, r]))
  let ours = (eid: unknown) =>
    String(eid) == actor ||
    byEid.get(String(eid))?.comps.session?.actor_eid == actor
  let recent = all
    .filter((r) =>
      r.comps.session && r.eid != sess?.eid &&
      r.comps.session.actor_eid == actor &&
      now - Date.parse(String(r.comps.entity?.modified_at ?? '')) < 7 * DAY
    )
    .sort((a, b) =>
      String(b.comps.entity?.modified_at ?? '')
        .localeCompare(String(a.comps.entity?.modified_at ?? ''))
    )
    .slice(0, 5)
  let got = recent
    .map((s) => {
      let cutoff = String(
        s.comps.session?.acked_at ?? s.comps.entity?.created_at ?? '',
      )
      let n = all.filter((r) => {
        let c = r.comps.comment
        return c && c.target_eid == s.eid && !c.event &&
          !ours(c.author_eid) &&
          String(r.comps.entity?.created_at ?? '') > cutoff
      }).length
      return [s, n] as const
    })
    .filter(([, n]) => n > 0)
  if (!got.length) return []
  if (got.length == 1) {
    let [s, n] = got[0]
    return [
      `## unheard — ${idOf(s)} got ${n} comment${
        n > 1 ? 's' : ''
      } after it wrapped (task show)`,
    ]
  }
  let ids = got.map(([s, n]) => `${idOf(s)} ×${n}`).join(', ')
  return [`## unheard — comments after they wrapped: ${ids} (task show)`]
}
let lately = (
  all: Row[],
  now: number,
  budget: number,
  scope?: string,
  skip?: string,
) => {
  if (budget < 4) return [] // claimed work ate the room — it wins
  let age = (r: Row) => {
    let t = Date.parse(String(r.comps.entity?.modified_at ?? ''))
    return Number.isNaN(t) ? Infinity : now - t
  }
  let byEid = new Map(all.map((r) => [r.eid, r.comps]))
  let fresh = all
    .filter((r) => r.comps.doc?.title && !r.comps.comment && age(r) < 7 * DAY)
    .filter((r) => belongs(r, scope))
    .sort((a, b) =>
      warm(b.comps, now, (e) => byEid.get(e)) -
      warm(a.comps, now, (e) => byEid.get(e))
    )
  if (!fresh.length) return []
  let briefs = fresh
    .filter((r) => r.comps.session && age(r) < DAY && r.eid != skip)
    .slice(0, 2)
  let today = fresh.filter((r) =>
    !r.comps.session && !r.comps.memory && age(r) < DAY
  ).slice(0, 4)
  let week = fresh.filter((r) =>
    !briefs.includes(r) && !r.comps.memory && age(r) >= DAY
  ).slice(0, 4)
  let mems = fresh.filter((r) => r.comps.memory).slice(0, 3)
  let title = (r: Row) => String(r.comps.doc?.title ?? '')
  let lines = ['## lately']
  for (let r of briefs) {
    lines.push(
      `- ${idOf(r)} ${snip(`${title(r)} · ${firstLine(r.comps.doc?.body)}`)}`,
    )
  }
  for (let r of today) lines.push(`- ${idOf(r)} ${snip(title(r))}`)
  if (week.length) {
    lines.push('### this week')
    for (let r of week) lines.push(`- ${idOf(r)} ${snip(title(r))}`)
  }
  if (mems.length) {
    lines.push('### memory')
    for (let r of mems) lines.push(`- ${idOf(r)} ${snip(title(r))}`)
  }
  return lines.slice(0, budget)
}

// The injection-loop digest: what a session sees at start — its claimed
// work (with unresolved gates and who holds them), or the top of the open
// board when it holds nothing, then the lately tier. ≤35 lines by
// construction: the tracker stays out of the way, it just makes the
// working set — and the recent past — impossible to lose.
// The digest is MARKDOWN, like every body in the graph — and dense on
// purpose: headings and lists interrupt paragraphs (CommonMark), so no
// blank line ever spends a budget line.
// No session = the PREVIEW: the digest a fresh session would boot with
// (open work, lately, memory — nothing claimed, nothing acked). The
// digest is PROJECT-AWARE: scope comes in explicitly (the hook's cwd, a
// preview's project arg) or derives from the session row's own cwd —
// suggestions and lately narrow to the project you're standing in;
// your claims and unscoped memories ride regardless.
export let contextDigest = (
  snap: Snapshot,
  session?: string,
  now = Date.now(),
  scope?: string,
) => {
  let all = rows(snap)
  let byEid = new Map(all.map((r) => [r.eid, r]))
  let sess = all.find((r) =>
    r.comps.session && String(r.comps.session.id) == session
  )
  let cwd = String(sess?.comps.session?.cwd ?? '')
  scope ??= repoAt(all, cwd)?.eid
  let here = scope ? byEid.get(scope) : undefined
  let mine = sess
    ? all.filter((r) => r.comps.claim?.session_eid == sess.eid)
    : []
  let lines = [
    '# ' + (session ? `tasks · session ${session}` : 'tasks · a preview') +
    (here ? ` · ${idOf(here)} ${here.comps.doc?.title ?? ''}` : ''),
  ]
  let show = (r: Row) => {
    lines.push(
      `- ${idOf(r)} ${r.comps.task?.status ?? r.kind} — ${
        r.comps.doc?.title ?? ''
      }`,
    )
    for (let d of snap.deps.filter((d) => d.parent == r.eid)) {
      let c = byEid.get(d.child)
      if (!c || d.type == 'reads') continue
      if (settled(String(c.comps.task?.status))) continue
      let who = claimant(all, c)
      lines.push(
        `  - ${d.type} → ${idOf(c)} (${c.comps.task?.status ?? c.kind}${
          who ? `, ⚑ ${who}` : ''
        })`,
      )
    }
  }
  if (mine.length) {
    lines.push('claimed by you:')
    mine.slice(0, 4).forEach(show)
  } else {
    // Suggestions are local when a scope stands (a fleet's worth of
    // open work is task list's job) — an idle project falls back to
    // the fleet rather than suggesting nothing.
    let open = all
      .filter((r) => r.comps.task && !settled(String(r.comps.task.status)))
      .filter((r) => !r.comps.claim)
    let local = scope ? open.filter((r) => belongs(r, scope)) : open
    if (!local.length) local = open
    lines.push(
      `nothing claimed. open work${here ? ' here' : ''}, board order:`,
    )
    local.sort(byBoard).slice(0, 5).forEach(show)
  }
  // Unread mail rides one line — the door teaches itself (adoption is
  // structural): the inbox predicate, scoped like everything else.
  let unread = all.filter(inboxMail(scope))
  if (unread.length) {
    lines.push(`## mail — ${unread.length} unread (task mail)`)
  }
  // What your past selves were told after they stopped listening —
  // history on one line, never re-injected as live conversation.
  lines.push(...unheard(all, sess, now))
  // The thread from last time: the newest brief by the SAME operator —
  // the final message wrap captured, or a hand-written doc, never a
  // stub — so a session wakes knowing where its predecessor left off.
  let actor = String(sess?.comps.session?.actor_eid ?? '') || scope
  let prev = actor
    ? all
      .filter((r) =>
        r.comps.session && r.eid != sess?.eid &&
        r.comps.session.actor_eid == actor && briefOf(r)
      )
      .sort((a, b) =>
        String(b.comps.entity?.modified_at ?? '')
          .localeCompare(String(a.comps.entity?.modified_at ?? ''))
      )[0]
    : undefined
  if (prev) {
    lines.push(
      `## previously — ${idOf(prev)} ${
        snip(String(prev.comps.doc?.title ?? ''))
      }`,
    )
    let told = briefOf(prev).split('\n').map((l) => l.trim()).filter(Boolean)
    for (let l of told.slice(0, 4)) lines.push(`> ${snip(l, 96)}`)
  }
  lines.push(...lately(all, now, 34 - lines.length, scope, prev?.eid))
  lines.push(
    `claim: \`task claim <id> ${
      session ?? '<session>'
    }\` · comment: \`task comment <id> "…"\` · release when done or handing off`,
  )
  return lines.slice(0, 35).join('\n')
}

// The comms bus, read side: what happened that this session hasn't seen —
// comments on tasks it CLAIMS plus comments aimed at the session entity
// itself (commenting on S-31 is how you message that agent). "Seen" is
// the session's own acked_at cursor; the returned ack change advances it,
// and the caller applies it exactly when the lines are actually shown.
export let notices = (snap: Snapshot, session: string) => {
  let all = rows(snap)
  let sess = all.find((r) =>
    r.comps.session && String(r.comps.session.id) == session
  )
  if (!sess) return { lines: [] as string[], ack: [] as Change[] }
  let cutoff = String(
    sess.comps.session.acked_at ?? sess.comps.entity?.created_at ?? '',
  )
  let mine = new Set(
    all.filter((r) => r.comps.claim?.session_eid == sess.eid)
      .map((r) => r.eid),
  )
  let byEid = new Map(all.map((r) => [r.eid, r]))
  let unseen = all
    .filter((r) => {
      let c = r.comps.comment
      if (!c || c.author_eid == sess.eid) return false
      if (!mine.has(String(c.target_eid)) && String(c.target_eid) != sess.eid) {
        return false
      }
      return String(r.comps.entity?.created_at ?? '') > cutoff
    })
    .sort((a, b) =>
      String(a.comps.entity?.created_at).localeCompare(
        String(b.comps.entity?.created_at),
      )
    )
  if (!unseen.length) return { lines: [] as string[], ack: [] as Change[] }
  // The byline walks the actor chain (comment → author → actor): a
  // session speaks as its operator "via S-n", a client as its person —
  // 'someone' only when the chain truly ends in the dark.
  let name = (r?: Row) =>
    String(
      r?.comps.alias?.slug ?? r?.comps.doc?.title ?? r?.comps.session?.id ??
        '',
    )
  let who = (eid: unknown) => {
    let r = byEid.get(String(eid))
    if (!r) return 'someone'
    let actor = byEid.get(
      String(r.comps.session?.actor_eid ?? r.comps.client?.actor_eid ?? ''),
    )
    if (r.comps.session) {
      return actor ? `${name(actor)} · via ${idOf(r)}` : name(r) || 'someone'
    }
    return name(actor) || name(r) || 'someone'
  }
  let lines = unseen.slice(0, 20).map((r) => {
    let c = r.comps.comment
    let target = byEid.get(String(c.target_eid))
    let at = target && target.eid != sess.eid ? `${idOf(target)} ` : ''
    let body = String(r.comps.doc?.body ?? '').split('\n')[0].slice(0, 120)
    return `${at}💬 ${who(c.author_eid)}: ${body}`
  })
  if (unseen.length > 20) lines.push(`…and ${unseen.length - 20} more`)
  let ack: Change[] = [{
    eid: sess.eid,
    name: 'session',
    comp: { acked_at: new Date().toISOString() },
  }]
  return { lines, ack }
}

// The wrap batch: a session ended — release every claim it holds, and
// on tasks it did NOT finish, leave a comment saying so (the simple
// audit: no timers, no heartbeats, just "ended before done" on the
// record). Finished work releases silently.
export let wrapChanges = (
  all: Row[],
  session: string,
  now = Date.now(),
  entries: JournalEntry[] = [],
  final?: string,
): Change[] => {
  let sess = all.find((r) =>
    r.comps.session && String(r.comps.session.id) == session
  )
  if (!sess) return []
  let held = all.filter((r) => r.comps.claim?.session_eid == sess.eid)
  return [
    ...held.flatMap((r): Change[] => [
      ...(settled(String(r.comps.task?.status)) ? [] : commentChanges(
        all,
        r.eid,
        '⚑ lease lapsed: session `' + session + '` ended before this was done',
        session,
        true, // machinery speaking, not the agent — never mailed
      ).slice(-2)), // the session exists — skip the mint, keep doc + comment
      { eid: r.eid, name: 'claim', comp: null },
    ]),
    ...brief(all, sess, held, now, entries, final),
  ]
}

// Continuity is SELF-AUTHORED (T-4469): the session's final message —
// the closing summary the operator already wrote — IS the brief for most
// sessions, captured into the session doc at wrap. A hand-written doc is
// never clobbered. Only when nothing was captured does the mechanical
// LEDGER stub ride instead — the standing invitation the scribe's sweep
// answers; continuity never depends on it.
export let STUB = 'Auto-written at wrap' // the scribe's queue marker
let brief = (
  all: Row[],
  sess: Row,
  held: Row[],
  now: number,
  entries: JournalEntry[],
  final?: string,
): Change[] => {
  let body = String(sess.comps.doc?.body ?? '')
  if (sess.comps.doc && body && !body.startsWith(STUB)) return []
  let authored = all.some((r) => r.comps.comment?.author_eid == sess.eid)
  if (!held.length && !authored && !entries.length) return []
  let day = new Date(now).toISOString().slice(0, 10)
  let title = String(sess.comps.doc?.title || `Work session ${day}`)
  if (final) {
    return [{ eid: sess.eid, name: 'doc', comp: { title, body: final } }]
  }
  let holding = held.map((r) =>
    `- ${idOf(r)} (${r.comps.task?.status ?? '?'}) ${r.comps.doc?.title ?? ''}`
  )
  let told = ledger(entries, all)
  return [{
    eid: sess.eid,
    name: 'doc',
    comp: {
      title,
      body: [
        `${STUB} — a stub, enrich me. The ledger is the journal's account;`,
        'the narrative is yours to add.',
        ...(told.length ? ['', '## Ledger', '', ...told] : []),
        '',
        '## Ended holding',
        '',
        ...(holding.length ? holding : ['- (no claims — comments only)']),
      ].join('\n'),
    },
  }]
}

// The dupe hint: after a create, ask the server what the graph already
// says like this (GET /similar — embed.ts). One line naming the
// neighbors above the floor, or '' — and '' on EVERY failure: a box
// without the embedder still creates, silently. The floor is empirical
// (measured on the live graph, 2026-07-22): an exact copy scores 1.0, a
// reworded twin ~0.83, a close sibling ~0.81, a same-domain different
// fact ~0.68 — 0.78 catches the twins (with margin for terser rewordings) and admits the odd sibling worth
// a look, while topic-mates stay out.
export let similarHint = async (
  text: string,
  self?: string,
  floor = 0.78,
) => {
  try {
    let res = await fetch(
      `http://${host()}/similar?q=${
        encodeURIComponent(text.slice(0, 2000))
      }&limit=4&floor=${floor}`,
    )
    if (!res.ok) return ''
    let hits = await res.json() as {
      eid: string
      id: string
      title: string
      score: number
    }[]
    let close = hits.filter((h) => h.eid != self)
    if (!close.length) return ''
    return `similar already in the graph: ${
      close.map((h) => `${h.id} “${h.title}” (${h.score.toFixed(2)})`)
        .join(' · ')
    } — possible duplicate; compare before keeping both`
  } catch {
    return '' // no server, no embedder, no hint — never a failed create
  }
}

// The scribe's desk, pinned: a cheap model wearing the scribe persona on
// the standing task — the same spawn whether the sweep or :scribe
// summons it.
export let DESK = {
  task: 'scribe-desk',
  provider: 'claude',
  model: 'claude-haiku-4-5',
  persona: 'scribe',
}

// The memory-save batch: a doc face (title = index line, body = the
// fact) plus the memory comp, sourced to the calling session (minted if
// new, like a claim's) and scoped to a project when one is named.
export let memoryChanges = (
  all: Row[],
  m: {
    title: string
    body?: string
    type?: string
    scope?: string
    session: string
  },
) => {
  let scope = m.scope ? find(all, m.scope) : undefined
  if (m.scope && !scope) throw new Error(`no entity: ${m.scope}`)
  let s = sessionFor(all, m.session)
  let eid = uuid()
  let changes: Change[] = [
    ...s.changes,
    { eid, name: 'doc', comp: { title: m.title, body: m.body ?? '' } },
    {
      eid,
      name: 'memory',
      comp: {
        type: m.type ?? 'project',
        source_eid: s.eid,
        scope_eid: scope?.eid ?? null,
      },
    },
  ]
  return { eid, changes }
}

// The recall INDEX: memories screened by preds, warmest first — one
// line each, no bodies. Expansion (and the recall bump that rides it)
// stays behind the ids door: recognition is not retrieval.
export let recallIndex = (
  all: Row[],
  preds: Pred[],
  now: number,
  limit = 20,
) =>
  all.filter((r) => r.comps.memory)
    .filter((r) => matchQuery(r.comps, preds))
    .map((r) => ({ r, score: hot(r.comps, now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ r, score }) => {
      let m = r.comps.memory
      let n = Number(r.comps.recall?.count ?? 0)
      let seen = m.last_confirmed_at
        ? ` · confirmed ${String(m.last_confirmed_at).slice(0, 10)}`
        : ''
      return `${idOf(r)} ${score.toFixed(2)} ${m.type}: ${
        r.comps.doc?.title ?? ''
      }${n ? ` · ${n}×` : ''}${seen}`
    })

// The claimant's session id, resolved through the claim's session entity.
// The entity's sentences, both directions, ids humanized — "whole" is a
// lie without them (an edge is data about the entity that lives in no
// component row, so rows() alone can never surface it).
export let edgesOf = (snap: Snapshot, all: Row[], eid: string) => {
  let name = (e: string) => {
    let r = all.find((x) => x.eid == e)
    return r ? idOf(r) : e
  }
  return {
    refs: snap.deps.filter((d) => d.parent == eid)
      .map((d) => ({ type: d.type, child: name(d.child) })),
    backrefs: snap.deps.filter((d) => d.child == eid)
      .map((d) => ({ type: d.type, parent: name(d.parent) })),
  }
}

// One entity as a reading document: frontmatter carries the data (scalar
// props walked straight off the vocabulary — a new column appears here
// with no edit), edges read as sentences, the doc body IS the body, and
// comments follow as a section. Every eid resolves to its human id +
// title, because nobody reads uuids. `task show`'s default face; --json
// keeps the machine shape.
export let showMd = (snap: Snapshot, all: Row[], row: Row) => {
  let byEid = new Map(all.map((r) => [r.eid, r]))
  let clip = (s: unknown, n = 64) => {
    let t = String(s ?? '').replace(/\s+/g, ' ').trim()
    return t.length > n ? t.slice(0, n - 1) + '…' : t
  }
  // "T-3695 (open) — title" — the way an edge endpoint reads anywhere.
  let said = (eid: unknown) => {
    let r = byEid.get(String(eid))
    if (!r) return String(eid)
    let st = r.comps.task?.status
    let t = r.comps.doc?.title ?? r.comps.session?.id ?? ''
    // a mail's stored subject may be an encoded-word — decode to read
    let title = clip(r.comps.mail ? unmime(String(t)) : t)
    return `${idOf(r)}${st ? ` (${st})` : ''}${title ? ` — ${title}` : ''}`
  }
  let fm = [`id: ${idOf(row)}`, `kind: ${row.kind}`]
  for (let [comp, props] of Object.entries(comps)) {
    // doc is the document below; a claim reads better as its holder line
    if (comp == 'doc' || comp == 'claim' || !row.comps[comp]) continue
    // Stamped columns render too — the OUTCOME (acted_at, to_addr,
    // frozen_at) is the half a reader came for; only the wire refuses
    // them, not the page.
    for (let prop of Object.keys({ ...props, ...stamped[comp] })) {
      let v = row.comps[comp][prop]
      if (v == null || v === '') continue
      let key = prop.endsWith('_eid') ? prop.slice(0, -4) : prop
      let owners = Object.keys(comps).filter((c) => prop in comps[c])
      if (owners.length > 1) key = `${comp}.${key}`
      fm.push(`${key}: ${prop.endsWith('_eid') ? said(v) : v}`)
    }
  }
  let held = claimant(all, row)
  if (held) fm.push(`claim: ${held}`)
  let ent = row.comps.entity ?? {}
  if (ent.created_at) fm.push(`created: ${ent.created_at}`)
  if (ent.modified_at && ent.modified_at != ent.created_at) {
    fm.push(`modified: ${ent.modified_at}`)
  }
  // Edges as sentences, grouped by verb; the far side says its state.
  let refs = snap.deps.filter((d) => d.parent == row.eid)
  let backs = snap.deps.filter((d) => d.child == row.eid)
  for (let type of [...new Set(refs.map((d) => d.type))]) {
    fm.push(`${type}:`)
    for (let d of refs.filter((r) => r.type == type)) {
      fm.push(`  - ${said(d.child)}`)
    }
  }
  if (backs.length) {
    fm.push('referenced by:')
    for (let d of backs) fm.push(`  - ${said(d.parent)} · ${d.type} this`)
  }
  let out = ['---', ...fm, '---']
  let title = String(row.comps.doc?.title ?? '')
  if (row.comps.mail) title = unmime(title) // display; stored as received
  let body = String(row.comps.doc?.body ?? '')
  if (title) out.push('', `# ${title}`)
  if (body) out.push('', body)
  let comments = all
    .filter((r) => r.comps.comment?.target_eid == row.eid)
    .sort((a, b) =>
      String(a.comps.entity?.created_at ?? '')
        .localeCompare(String(b.comps.entity?.created_at ?? ''))
    )
  if (comments.length) {
    out.push('', '## Comments')
    for (let c of comments) {
      let author = c.comps.comment?.author_eid
      let by = author ? ` · ${said(author)}` : ''
      out.push('', `— ${c.comps.entity?.created_at ?? ''}${by}`, '')
      out.push(String(c.comps.doc?.body ?? ''))
    }
  }
  return out.join('\n')
}

export let claimant = (all: Row[], r: Row) => {
  let seid = r.comps.claim?.session_eid
  if (!seid) return undefined
  let s = all.find((x) => x.eid == seid)
  return String(s?.comps.session?.id ?? seid)
}
