// The server-owned half of graph-native Session logs: append immutable entry
// entities, read one ordered partition, and lease one bounded runner action.
// Model projection and tool execution live in runner.ts; process-backed JSONL
// sessions stay in sessions.ts.
import { DatabaseSync } from './sqlite.ts'
import { apply, entriesOf, entryOf, record } from './db.ts'
import { type Trace, trace } from './effects.ts'
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

// The eid→id storage seam (D-18866): component tables are keyed by the owner's
// internal int id and reference columns store int ids, while this module's
// callers speak EIDs. `OWNED` matches a component row by its owner eid; `idOf`
// resolves an eid to its id inline (for a reference filter); `refEid` projects a
// stored ref id back to its eid inside a SELECT. Each keeps its bound eid param.
let OWNED = `entity = (select id from entity where eid = ?)`
let idOf = `(select id from entity where eid = ?)`
let refEid = (col: string) => `(select eid from entity where id = ${col})`

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
  effects: Trace = trace(),
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
  return {
    eids,
    changes: apply(db, changes, effects, writer, imports),
    trace: effects,
  }
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
      `select i.line from entry e join imported i on i.entity = e.entity
       where e.session = ${idOf} and i.source = ?`,
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
      `select o.eid as eid, c.key from entry e
         join entity o on o.id = e.entity
         join call c on c.entity = e.entity
       where e.session = ${idOf} and c.key is not null`,
    ).all(session) as { eid: string; key: string }[]).map(
      (r) => [r.key, r.eid],
    ),
  )

// Page a session's partition from a seq lower bound (inclusive) to the tail.
// entriesOf paginates for lazy clients, so this pages to exhaustion. readEntries
// takes the whole log; standing maintenance takes only the current turn's tail
// (from its generation edge, standingWindow — T-21829), keeping that hot write
// path O(turn) instead of O(N) per turn edge.
export let entriesFrom = (db: DatabaseSync, session: string, from: number) => {
  let all: ReturnType<typeof entriesOf> = []
  for (let after = from - 1;;) {
    let page = entriesOf(db, session, after, 5000)
    all.push(...page)
    if (page.length < 5000) return all
    after = page.at(-1)!.seq
  }
}

// UI and audit reads retain the complete immutable partition.
export let readEntries = (db: DatabaseSync, session: string) =>
  entriesFrom(db, session, 1)

// The seq boundary standingOf's verdict depends on (T-21829): the LAST
// generation's turn start. standingOf reads only the current turn's tail — the
// last generation, the entries after its `through` edge, and any unresolved
// lease/call. All of those live at or after that edge because turns are serial
// per session (the runner leases one action at a time) and a completed turn is
// fully settled — its generations delivered with a final-answer output, its
// calls answered by results, its leases removed. So reading from this boundary
// yields the IDENTICAL standingOf verdict as the whole log, over a bounded
// window. The through row is INCLUDED (from = its seq) so standingOf recomputes
// the same `edge` internally. No generation yet → 1 (a short pre-turn log, read
// whole). The tail-scan back to the last generation is itself bounded by one
// turn (the runner appends generations, then that turn's tool loop after them).
export let standingWindow = (db: DatabaseSync, session: string): number => {
  let row = db.prepare(
    `select coalesce(t.seq, e.seq) as edge
       from entry e
       join generation g on g.entity = e.entity
       left join entry t on t.entity = g.through
      where e.session = ${idOf}
      order by e.seq desc limit 1`,
  ).get(session) as { edge: number } | undefined
  return row?.edge ?? 1
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
    select oe.eid as eid, e.seq, ${refEid('o.source')} as source,
           g.provider, p.format, p.data
    from entry e
    join entity oe on oe.id = e.entity
    join checkpoint c on c.entity = e.entity
    join output o on o.entity = e.entity
    join entry s on s.entity = o.source and s.session = e.session
    join generation g on g.entity = o.source
    join opaque p on p.entity = e.entity
    where e.session = ${idOf} and e.seq <= ? and g.provider = ?
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
    `select seq from entry where ${OWNED} and session = ${idOf}`,
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
  select o.eid as eid, e.seq from entry e
  join entity o on o.id = e.entity
  where e.session = ${idOf}
    and not exists (select 1 from lease l where l.entity = e.entity)
    and not exists (select 1 from error x where x.entity = e.entity)
    and not exists (select 1 from cancel c where c.target = e.entity)
    and (
      (exists (select 1 from generation g where g.entity = e.entity)
       and not exists (select 1 from imported i where i.entity = e.entity)
       and not exists (select 1 from delivered d where d.entity = e.entity)
       and not exists (select 1 from output o2 where o2.source = e.entity))
      or
      (exists (select 1 from call c where c.entity = e.entity)
       and not exists (select 1 from imported i where i.entity = e.entity)
       and not exists (select 1 from result r where r.call = e.entity))
    )
  order by e.seq`

// Ready means no runner has attempted the operation. Expired leases are a
// separate audit path because replaying an external side effect blindly is
// less safe than surfacing an ambiguous outcome.
export let readyEntries = (db: DatabaseSync, session: string) =>
  db.prepare(readySql).all(session) as { eid: string; seq: number }[]

export let expiredLeases = (db: DatabaseSync, at = new Date().toISOString()) =>
  db.prepare(
    `select lo.eid as eid, ${refEid('l.holder')} as holder, l.at, l.until,
            ${refEid('e.session')} as session, e.seq
     from lease l
     join entity lo on lo.id = l.entity
     join entry e on e.entity = l.entity
     where l.until <= ? order by l.until`,
  ).all(at) as (LeaseToken & { session: string; seq: number })[]

let owns = (db: DatabaseSync, token: LeaseToken) =>
  db.prepare(
    `select 1 from lease where ${OWNED} and holder = ${idOf} and at = ?`,
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
    let row = db.prepare(
      `select ${refEid('session')} as session from entry where ${OWNED}`,
    ).get(eid) as
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
      !db.prepare(`select 1 from runner where ${OWNED}`).get(holder)
    ) {
      db.exec('rollback')
      return undefined
    }
    db.prepare(
      `insert into lease (entity, holder, at, until)
         values (${idOf}, ${idOf}, ?, ?)`,
    ).run(eid, holder, token.at, token.until)
    record(db, [change], holder)
    db.exec('commit')
    return { token, changes: [change] }
  } catch (e) {
    db.exec('rollback')
    throw e
  }
}

// Generations and read-only graph calls only observe external state. Replaying
// them may repeat provider work, billing, or serve bookkeeping, but cannot
// repeat the caller's side effect. Reclaim only those classes under the
// expired lease's full CAS; every other call remains ambiguous.
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
         when exists (select 1 from generation g where g.entity = l.entity)
           then 'generation'
         else 'call'
       end as kind
       from lease l
       where l.${OWNED} and l.holder = ${idOf} and l.at = ? and l.until = ?
         and l.until <= ?
         and not exists (select 1 from error x where x.entity = l.entity)
         and not exists (select 1 from cancel c where c.target = l.entity)
         and (
           (exists (select 1 from generation g where g.entity = l.entity)
             and not exists (select 1 from output o where o.source = l.entity)
             and not exists (select 1 from delivered d where d.entity = l.entity))
           or
           (exists (select 1 from call c where c.entity = l.entity)
             and (
               exists (select 1 from graph_query q where q.entity = l.entity)
               or exists (select 1 from task_context t where t.entity = l.entity)
             )
             and not exists (select 1 from result r where r.call = l.entity))
         )`,
    ).get(stale.eid, stale.holder, stale.at, stale.until, token.at) as
      | { kind: 'generation' | 'call' }
      | undefined
    let runner = db.prepare(`select 1 from runner where ${OWNED}`).get(holder)
    if (!safe || !runner) {
      db.exec('rollback')
      return undefined
    }
    db.prepare(
      `update lease set holder = ${idOf}, at = ?, until = ? where ${OWNED}`,
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
      `update lease set until = ? where ${OWNED} and holder = ${idOf} and at = ?
       and not exists (select 1 from cancel c where c.target = lease.entity)`,
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
  (db.prepare(`select name from runner where ${OWNED}`).get(eid) as {
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
      db.prepare(`select 1 from cancel where target = ${idOf}`).get(token.eid)
    ) {
      db.exec('rollback')
      return []
    }
    if (usage) {
      db.prepare(
        `insert into usage (entity, input, cached, output, reasoning)
         values (${idOf}, ?, ?, ?, ?)`,
      ).run(
        token.eid,
        usage.input,
        usage.cached,
        usage.output,
        usage.reasoning,
      )
    }
    if (model) {
      db.prepare(`update generation set serving_model = ? where ${OWNED}`)
        .run(model, token.eid)
    }
    db.prepare(
      `insert into delivered (entity, at, via) values (${idOf}, ?, ?)`,
    ).run(token.eid, at, via)
    db.prepare(`delete from lease where ${OWNED}`).run(token.eid)
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
      !db.prepare(`select 1 from cancel where target = ${idOf}`).get(token.eid)
    ) {
      db.exec('rollback')
      return []
    }
    db.prepare(`delete from lease where ${OWNED}`).run(token.eid)
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
      !db.prepare(`select 1 from result where call = ${idOf}`).get(token.eid) ||
      db.prepare(`select 1 from cancel where target = ${idOf}`).get(token.eid)
    ) {
      db.exec('rollback')
      return []
    }
    db.prepare(`delete from lease where ${OWNED}`).run(token.eid)
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
    db.prepare(
      `insert into error (entity, at, message) values (${idOf}, ?, ?)`,
    )
      .run(token.eid, comp.at, message)
    db.prepare(`delete from lease where ${OWNED}`).run(token.eid)
    record(db, changes, token.holder)
    db.exec('commit')
    return changes
  } catch (e) {
    db.exec('rollback')
    throw e
  }
}
