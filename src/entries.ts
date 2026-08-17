// The server-owned half of graph-native Session logs: append immutable entry
// entities, read one ordered partition, and lease one bounded runner action.
// Model projection and tool execution live in runner.ts; process-backed JSONL
// sessions stay in sessions.ts.
import { DatabaseSync } from './sqlite.ts'
import { apply, entriesOf, entryOf, record } from './db.ts'
import { trace } from './effects.ts'
import { checkpointValid, type EntryRow } from './replay.ts'
import { type Change, uuid } from './types.ts'

export type EntrySpec = Record<string, Record<string, unknown>>

// Where an imported entry came from — the ingest coordinate (D-16704). One
// coord marks every entry a single source line produced, so the whole batch
// shares a collision-free position: (session, source, line).
export type Coord = { source: string; line: number }

export type LeaseToken = {
  eid: string
  holder: string
  at: string
  until: string
}

export type UsageValue = {
  input: number
  cached: number
  output: number
  reasoning: number
}

// `imported` never rides a spec: it is server-stamped through apply()'s
// `imports` path (below), so a spec that names it is a caller confusing
// history with its coordinate.
let forbidden = new Set(['entity', 'entry', 'lease', 'usage', 'imported'])

// Append order is spec order, then component insertion order within a spec.
// apply() assigns seq while holding its write transaction and returns the
// authoritative entry stamp beside these changes. `coord` (when the specs are
// IMPORTED from a source line) stamps `imported{source,line}` on every entry
// this call mints, in the same transaction — so the entry and its cursor
// coordinate commit together or not at all (D-16704). The `trace` is filled in
// as apply() runs (which comps this batch created) and returned beside the
// changes, so a caller at the LIVE edge can dispatch() the created effects —
// e.g. created(message) → auto-recall (T-17306). Callers ingesting history
// (backfill, initial catch-up) ignore it and no effect fires.
export let append = (
  db: DatabaseSync,
  session: string,
  specs: EntrySpec[],
  writer?: string | null,
  ids?: string[],
  coord?: Coord,
) => {
  if (ids && ids.length != specs.length) {
    throw new Error('entry ids must match specs')
  }
  let eids = ids ?? specs.map(() => uuid())
  let changes: Change[] = []
  for (let [i, spec] of specs.entries()) {
    let eid = eids[i]
    changes.push({ eid, name: 'entry', comp: { session } })
    for (let [name, comp] of Object.entries(spec)) {
      if (forbidden.has(name)) throw new Error(`entry facet refused: ${name}`)
      changes.push({ eid, name, comp })
    }
  }
  let imports = coord ? new Map(eids.map((eid) => [eid, coord])) : undefined
  let t = trace()
  return { eids, changes: apply(db, changes, t, writer, imports), trace: t }
}

// The durable cursor, derived (D-16704): the (source, line) coordinates already
// present in a Session's partition ARE its ingest position — there is no
// mutable cursor row. Loaded once when a tailer starts so a re-drain skips
// every line it already ingested in memory, appending only the gaps.
export let importedLines = (
  db: DatabaseSync,
  session: string,
  source: string,
): Set<number> =>
  new Set(
    (db.prepare(
      `select i.line from entry e join imported i on i.eid = e.eid
       where e.session = ? and i.source = ?`,
    ).all(session, source) as { line: number }[]).map((r) => r.line),
  )

// The tool-call correlation map, rebuilt from durable evidence: a provider
// call_id → the call entry's eid, so a tool RESULT arriving on a later source
// line (claude's tool_result references an earlier tool_use) can name the call
// it answers even across a daemon restart, when the in-memory map was lost.
export let callKeys = (
  db: DatabaseSync,
  session: string,
): Map<string, string> =>
  new Map(
    (db.prepare(
      `select c.eid, c.key from entry e join call c on c.eid = e.eid
       where e.session = ? and c.key is not null`,
    ).all(session) as { eid: string; key: string }[]).map(
      (r) => [r.key, r.eid],
    ),
  )

// UI and audit reads retain the complete immutable partition. entriesOf
// paginates for lazy clients, so this door pages to exhaustion.
export let readEntries = (db: DatabaseSync, session: string) => {
  let all: ReturnType<typeof entriesOf> = []
  for (let after = 0;;) {
    let page = entriesOf(db, session, after, 5000)
    all.push(...page)
    if (page.length < 5000) return all
    after = page.at(-1)!.seq
  }
}

export let readEntry = (db: DatabaseSync, eid: string) => entryOf(db, eid)

type CheckpointRow = {
  eid: string
  seq: number
  source: string
  provider: string
  format: string
  data: string
}

let checkpoint = (
  db: DatabaseSync,
  session: string,
  through: number,
  provider: string,
) => {
  let rows = db.prepare(`
    select e.eid, e.seq, o.source, g.provider, p.format, p.data
    from entry e
    join checkpoint c on c.eid = e.eid
    join output o on o.eid = e.eid
    join entry s on s.eid = o.source and s.session = e.session
    join generation g on g.eid = o.source
    join opaque p on p.eid = e.eid
    where e.session = ? and e.seq <= ? and g.provider = ?
    order by e.seq desc
  `).all(session, through, provider) as CheckpointRow[]
  return rows.find((value) => {
    let source: EntryRow = {
      eid: value.source,
      seq: 0,
      comps: { generation: { provider: value.provider } },
    }
    let row: EntryRow = {
      eid: value.eid,
      seq: value.seq,
      comps: {
        checkpoint: {},
        output: { source: value.source },
        opaque: { format: value.format, data: value.data },
      },
    }
    return checkpointValid(row, new Map([[source.eid, source]]), provider)
  })
}

// A provider executes one frozen generation prefix. Its newest replayable
// checkpoint replaces everything before it; projection needs only that
// checkpoint's source generation, the closed tail through generation.through,
// and the generation row itself.
export let readReplay = (db: DatabaseSync, generation: string) => {
  let current = readEntry(db, generation)
  if (!current?.comps.generation) throw new Error('no generation entry')
  let provider = String(current.comps.generation.provider ?? '')
  let session = String(current.comps.entry.session)
  let through = String(current.comps.generation.through)
  let target = db.prepare(
    'select seq from entry where eid = ? and session = ?',
  ).get(through, session) as { seq: number } | undefined
  if (!target) throw new Error('generation prefix is missing')
  let point = checkpoint(db, session, target.seq, provider)
  let rows: EntryRow[] = []
  for (let after = (point?.seq ?? 1) - 1;;) {
    let page = entriesOf(db, session, after, 5000, target.seq)
    rows.push(...page)
    if (page.length < 5000) break
    after = page.at(-1)!.seq
  }
  if (point) {
    let source = readEntry(db, point.source)
    if (source) rows.push(source)
  }
  rows.push(current)
  return [...new Map(rows.map((row) => [row.eid, row])).values()]
}

// An `imported` entry is ingested history, never runnable work (D-16704): it
// carries no lease and, structurally, no live generation/call the runner should
// touch. Excluding it on both arms is defense-in-depth — a mis-scheduled
// imported generation or call can never be leased, run, advanced, or settled.
let readySql = `
  select e.eid, e.seq from entry e
  where e.session = ?
    and not exists (select 1 from lease l where l.eid = e.eid)
    and not exists (select 1 from error x where x.eid = e.eid)
    and not exists (select 1 from cancel c where c.target = e.eid)
    and (
      (exists (select 1 from generation g where g.eid = e.eid)
       and not exists (select 1 from imported i where i.eid = e.eid)
       and not exists (select 1 from delivered d where d.eid = e.eid)
       and not exists (select 1 from output o where o.source = e.eid))
      or
      (exists (select 1 from call c where c.eid = e.eid)
       and not exists (select 1 from imported i where i.eid = e.eid)
       and not exists (select 1 from result r where r.call = e.eid))
    )
  order by e.seq`

// Ready means no runner has attempted the operation. Expired leases are a
// separate audit path because replaying an external side effect blindly is
// less safe than surfacing an ambiguous outcome.
export let readyEntries = (db: DatabaseSync, session: string) =>
  db.prepare(readySql).all(session) as { eid: string; seq: number }[]

export let expiredLeases = (db: DatabaseSync, at = new Date().toISOString()) =>
  db.prepare(
    `select l.eid, l.holder, l.at, l.until, e.session, e.seq
     from lease l join entry e on e.eid = l.eid
     where l.until <= ? order by l.until`,
  ).all(at) as (LeaseToken & { session: string; seq: number })[]

let owns = (db: DatabaseSync, token: LeaseToken) =>
  db.prepare(
    'select 1 from lease where eid = ? and holder = ? and at = ?',
  ).get(token.eid, token.holder, token.at)

// One absent lease wins. Reclaim is deliberate: the caller must first settle
// the expired attempt as ambiguous or prove this operation idempotent.
export let takeEntry = (
  db: DatabaseSync,
  eid: string,
  holder: string,
  ttl = 30_000,
  clock = () => new Date(),
): { token: LeaseToken; changes: Change[] } | undefined => {
  let now = clock()
  let token: LeaseToken = {
    eid,
    holder,
    at: now.toISOString(),
    until: new Date(now.getTime() + Math.max(1, ttl)).toISOString(),
  }
  let change: Change = { eid, name: 'lease', comp: { ...token } }
  db.exec('begin immediate')
  try {
    let row = db.prepare('select session from entry where eid = ?').get(eid) as
      | { session: string }
      | undefined
    if (!row) {
      db.exec('rollback')
      return undefined
    }
    let runnable = db.prepare(
      `select 1 from (${readySql}) ready where ready.eid = ?`,
    ).get(row.session, eid)
    if (
      !runnable ||
      !db.prepare('select 1 from runner where eid = ?').get(holder)
    ) {
      db.exec('rollback')
      return undefined
    }
    db.prepare(
      'insert into lease (eid, holder, at, until) values (?, ?, ?, ?)',
    ).run(eid, holder, token.at, token.until)
    record(db, [change], holder)
    db.exec('commit')
    return { token, changes: [change] }
  } catch (e) {
    db.exec('rollback')
    throw e
  }
}

// Generations and graph_query calls only read external state. Replaying either
// may repeat provider work, billing, or a graph read, but cannot repeat a
// hosted side effect. Reclaim only those classes under the expired lease's
// full CAS; every other call remains ambiguous.
export let reclaimEntry = (
  db: DatabaseSync,
  stale: LeaseToken,
  holder: string,
  ttl = 30_000,
  clock = () => new Date(),
):
  | { token: LeaseToken; kind: 'generation' | 'call'; changes: Change[] }
  | undefined => {
  let now = clock()
  let token: LeaseToken = {
    eid: stale.eid,
    holder,
    at: now.toISOString(),
    until: new Date(now.getTime() + Math.max(1, ttl)).toISOString(),
  }
  let change: Change = { eid: stale.eid, name: 'lease', comp: { ...token } }
  db.exec('begin immediate')
  try {
    let safe = db.prepare(
      `select case
         when exists (select 1 from generation g where g.eid = l.eid)
           then 'generation'
         else 'call'
       end as kind
       from lease l
       where l.eid = ? and l.holder = ? and l.at = ? and l.until = ?
         and l.until <= ?
         and not exists (select 1 from error x where x.eid = l.eid)
         and not exists (select 1 from cancel c where c.target = l.eid)
         and (
           (exists (select 1 from generation g where g.eid = l.eid)
             and not exists (select 1 from output o where o.source = l.eid)
             and not exists (select 1 from delivered d where d.eid = l.eid))
           or
           (exists (select 1 from call c join graph_query q on q.eid = c.eid
             where c.eid = l.eid)
             and not exists (select 1 from result r where r.call = l.eid))
         )`,
    ).get(stale.eid, stale.holder, stale.at, stale.until, token.at) as
      | { kind: 'generation' | 'call' }
      | undefined
    let runner = db.prepare('select 1 from runner where eid = ?').get(holder)
    if (!safe || !runner) {
      db.exec('rollback')
      return undefined
    }
    db.prepare(
      'update lease set holder = ?, at = ?, until = ? where eid = ?',
    ).run(holder, token.at, token.until, token.eid)
    record(db, [change], holder)
    db.exec('commit')
    return { token, kind: safe.kind, changes: [change] }
  } catch (error) {
    db.exec('rollback')
    throw error
  }
}

// A lease is a liveness lease: while its holder is alive and still working an
// operation that outlives the base TTL, renewal pushes `until` forward so no
// successor mistakes a long generation or command for a dead runner and
// reclaims (double-run) or fails it. The CAS matches the held lease exactly
// (eid+holder+at, unchanged by renewal, so the holder's own settle/valid path
// is untouched) and refuses a cancelled one. undefined means the lease is gone
// — the caller's heartbeat simply stops.
export let renewEntry = (
  db: DatabaseSync,
  token: LeaseToken,
  ttl = 30_000,
  clock = () => new Date(),
): { token: LeaseToken; changes: Change[] } | undefined => {
  let until = new Date(clock().getTime() + Math.max(1, ttl)).toISOString()
  let next: LeaseToken = { ...token, until }
  let change: Change = { eid: token.eid, name: 'lease', comp: { ...next } }
  db.exec('begin immediate')
  try {
    let n = db.prepare(
      `update lease set until = ? where eid = ? and holder = ? and at = ?
       and not exists (select 1 from cancel c where c.target = lease.eid)`,
    ).run(until, token.eid, token.holder, token.at).changes
    if (!n) {
      db.exec('rollback')
      return undefined
    }
    record(db, [change], token.holder)
    db.exec('commit')
    return { token: next, changes: [change] }
  } catch (e) {
    db.exec('rollback')
    throw e
  }
}

let normalizedUsage = (value: UsageValue) => ({
  input: Math.max(0, Math.trunc(value.input)),
  cached: Math.max(0, Math.trunc(value.cached)),
  output: Math.max(0, Math.trunc(value.output)),
  reasoning: Math.max(0, Math.trunc(value.reasoning)),
})

let runnerName = (db: DatabaseSync, eid: string) =>
  (db.prepare('select name from runner where eid = ?').get(eid) as {
    name: string
  }).name

// The provider returned and its output entries have already appended. Usage,
// generation settlement, and lease release land together under the lease CAS.
export let settleGeneration = (
  db: DatabaseSync,
  token: LeaseToken,
  value?: UsageValue,
  clock = () => new Date(),
  model?: string,
): Change[] => {
  let at = clock().toISOString()
  let usage = value ? normalizedUsage(value) : undefined
  let via = `runner:${runnerName(db, token.holder)}`
  let changes: Change[] = [
    ...(model
      ? [{
        eid: token.eid,
        name: 'generation',
        comp: { serving_model: model },
      } as Change]
      : []),
    ...(usage
      ? [{
        eid: token.eid,
        name: 'usage',
        comp: { eid: token.eid, ...usage },
      } as Change]
      : []),
    {
      eid: token.eid,
      name: 'delivered',
      comp: { eid: token.eid, at, via },
    },
    { eid: token.eid, name: 'lease', comp: null },
  ]
  db.exec('begin immediate')
  try {
    if (
      !owns(db, token) ||
      db.prepare('select 1 from cancel where target = ?').get(token.eid)
    ) {
      db.exec('rollback')
      return []
    }
    if (usage) {
      db.prepare(
        `insert into usage (eid, input, cached, output, reasoning)
         values (?, ?, ?, ?, ?)`,
      ).run(
        token.eid,
        usage.input,
        usage.cached,
        usage.output,
        usage.reasoning,
      )
    }
    if (model) {
      db.prepare('update generation set serving_model = ? where eid = ?')
        .run(model, token.eid)
    }
    db.prepare(
      'insert into delivered (eid, at, via) values (?, ?, ?)',
    ).run(token.eid, at, via)
    db.prepare('delete from lease where eid = ?').run(token.eid)
    record(db, changes, token.holder)
    db.exec('commit')
    return changes
  } catch (e) {
    db.exec('rollback')
    throw e
  }
}

// Cancellation has already landed as an immutable audit entry. Releasing the
// matching lease prevents a late provider/tool result from settling while
// preserving the request that stopped it.
export let cancelEntry = (
  db: DatabaseSync,
  token: LeaseToken,
): Change[] => {
  let change: Change = { eid: token.eid, name: 'lease', comp: null }
  db.exec('begin immediate')
  try {
    if (
      !owns(db, token) ||
      !db.prepare('select 1 from cancel where target = ?').get(token.eid)
    ) {
      db.exec('rollback')
      return []
    }
    db.prepare('delete from lease where eid = ?').run(token.eid)
    record(db, [change], token.holder)
    db.exec('commit')
    return [change]
  } catch (e) {
    db.exec('rollback')
    throw e
  }
}

// A call is complete only after its correlated result entry exists. Removing
// the lease is the only mutable fact; the call/result pair remains immutable.
export let settleCall = (db: DatabaseSync, token: LeaseToken): Change[] => {
  let change: Change = { eid: token.eid, name: 'lease', comp: null }
  db.exec('begin immediate')
  try {
    if (
      !owns(db, token) ||
      !db.prepare('select 1 from result where call = ?').get(token.eid) ||
      db.prepare('select 1 from cancel where target = ?').get(token.eid)
    ) {
      db.exec('rollback')
      return []
    }
    db.prepare('delete from lease where eid = ?').run(token.eid)
    record(db, [change], token.holder)
    db.exec('commit')
    return [change]
  } catch (e) {
    db.exec('rollback')
    throw e
  }
}

// Infrastructure failure is an outcome facet on the attempted entry. Error
// text is caller-scrubbed; this boundary never accepts a provider credential.
export let failEntry = (
  db: DatabaseSync,
  token: LeaseToken,
  message: string,
  clock = () => new Date(),
): Change[] => {
  let comp = { eid: token.eid, at: clock().toISOString(), message }
  let changes: Change[] = [
    { eid: token.eid, name: 'error', comp },
    { eid: token.eid, name: 'lease', comp: null },
  ]
  db.exec('begin immediate')
  try {
    if (!owns(db, token)) {
      db.exec('rollback')
      return []
    }
    db.prepare('insert into error (eid, at, message) values (?, ?, ?)')
      .run(token.eid, comp.at, message)
    db.prepare('delete from lease where eid = ?').run(token.eid)
    record(db, changes, token.holder)
    db.exec('commit')
    return changes
  } catch (e) {
    db.exec('rollback')
    throw e
  }
}
