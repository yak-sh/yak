// The server-owned half of graph-native Session logs: append immutable entry
// entities, read one ordered partition, and lease one bounded runner action.
// Model projection and tool execution live in runner.ts; process-backed JSONL
// sessions stay in sessions.ts.
import { DatabaseSync } from 'node:sqlite'
import { apply, entriesOf, record } from './db.ts'
import { type Change, uuid } from './types.ts'

export type EntrySpec = Record<string, Record<string, unknown>>

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

let forbidden = new Set(['entity', 'entry', 'lease', 'usage'])

// Append order is spec order, then component insertion order within a spec.
// apply() assigns seq while holding its write transaction and returns the
// authoritative entry stamp beside these changes.
export let append = (
  db: DatabaseSync,
  session: string,
  specs: EntrySpec[],
  writer?: string | null,
  ids?: string[],
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
  return { eids, changes: apply(db, changes, undefined, writer) }
}

export let readEntries = entriesOf

let readySql = `
  select e.eid, e.seq from entry e
  where e.session = ?
    and not exists (select 1 from lease l where l.eid = e.eid)
    and not exists (select 1 from error x where x.eid = e.eid)
    and not exists (select 1 from cancel c where c.target = e.eid)
    and (
      (exists (select 1 from generation g where g.eid = e.eid)
       and not exists (select 1 from delivered d where d.eid = e.eid)
       and not exists (select 1 from output o where o.source = e.eid))
      or
      (exists (select 1 from call c where c.eid = e.eid)
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
