// Fleet lifecycle policy, shared by live apply and the composed phase hooks.
// SQL stays behind the host's cached statements; no graph apply or effects run
// here. The caller owns the write lock, batch clock and ordered operation log.
import type { Change } from '../types.ts'
import type { Sql, Statement } from './sql.ts'

export type LifecycleHost = {
  db: Sql
  prepare: (sql: string) => Statement
  id: (eid: string | null) => number | null
  component: (eid: string, name: string) => Record<string, unknown> | undefined
  venture: (cwd?: string | null) => string | null
  sender: (writer?: string | null) => string | null
  stamps: string[]
  clocked: string[]
  facetCols: (name: 'worktree' | 'runtime') => string[]
  quote: (name: string) => string
}
export type PriorClaim = {
  eid: string
  claimed_at: string
  claim_order: number
  actor: string | null
  cwd: string | null
}
export type LifecycleBatch = {
  changes: Change[]
  extra: Change[]
  touched: Set<string>
  minted: Set<string>
  createdComps: Set<string>
  now: string
  actor: string | null
  via: string | null
  person: () => boolean
  writer?: string | null
  imports?: Map<string, { source: string; line: number }>
  took: (eid: string, name: string) => void
}

export let priorClaimsOf = (host: LifecycleHost): PriorClaim[] => {
  return host.prepare(
    `
      select co.eid as eid, c.claimed_at, c.rowid as claim_order,
             act.eid as actor, s.cwd as cwd
      from claim c
      join entity co on co.id = c.entity
      left join session s on s.entity = c.session
      left join entity act on act.id = s.actor
    `,
  ).all() as {
    eid: string
    claimed_at: string
    claim_order: number
    actor: string | null
    cwd: string | null
  }[]
}

export let lifecycleBefore = (
  host: LifecycleHost,
  batch: LifecycleBatch,
  priorClaims: PriorClaim[],
) => {
  let { changes, extra, touched, now, took } = batch
  // Taking a task again pops it; settling one removes it. Releasing an
  // unsettled task pushes it for the holder's actor. A wrap releases several
  // claims in one batch, so claimed_at supplies their nested order and rank
  // preserves it after those lease rows are gone.
  let finalClaims = new Set(
    (host.prepare(
      'select o.eid as eid from claim c join entity o on o.id = c.entity',
    ).all() as { eid: string }[])
      .map((r) => r.eid),
  )
  // Status is derived (D-24102): settled = wears completed or cancelled. A
  // non-task eid returns no row, exactly as the old `select status` did.
  let settledRow = host.prepare(
    `select (
         exists(select 1 from cancelled x where x.entity = t.entity)
         or exists(select 1 from completed x where x.entity = t.entity)
       ) as settled
       from task t where t.entity = (select id from entity where eid = ?)`,
  )
  let clear = new Set(
    changes.filter((c) =>
      c.name == 'claim' || c.name == 'task' || c.name == 'completed' ||
      c.name == 'cancelled'
    )
      .map((c) => c.eid),
  )
  for (let eid of clear) {
    let task = settledRow.get(eid) as { settled: number } | undefined
    if (!finalClaims.has(eid) && task && !task.settled) continue
    if (
      host.prepare(
        'delete from resume where entity = (select id from entity where eid = ?)',
      ).run(eid).changes
    ) {
      took(eid, 'resume')
      extra.push({ eid, name: 'resume', comp: null })
    }
  }
  let released = priorClaims
    .filter((c) => !finalClaims.has(c.eid))
    .filter((c) => {
      let task = settledRow.get(c.eid) as { settled: number } | undefined
      return task && !task.settled
    })
    .map((c) => ({ ...c, actor: c.actor ?? host.venture(c.cwd) }))
    .filter((c) => c.actor)
    .sort((a, b) =>
      a.claimed_at.localeCompare(b.claimed_at) ||
      a.claim_order - b.claim_order
    )
  let top = Number(
    (host.prepare('select coalesce(max(rank), 0) as rank from resume')
      .get() as {
        rank: number
      }).rank,
  )
  let push = host.prepare(
    `
      insert into resume (entity, actor, at, rank)
      values ((select id from entity where eid = ?), ?, ?, ?)
      on conflict(entity) do update set actor = excluded.actor,
        at = excluded.at, rank = excluded.rank
    `,
  )
  for (let item of released) {
    let comp = { actor: String(item.actor), at: now, rank: ++top }
    push.run(item.eid, host.id(comp.actor), comp.at, comp.rank)
    extra.push({ eid: item.eid, name: 'resume', comp })
  }
  // A session that RAN somewhere but names no actor gets one from where
  // it stands — the writing identity is never blank (T-6669). Resolved
  // from the session row's CURRENT cwd (not a client's stale snapshot,
  // the bug that left real sessions blank when cwd and reify split across
  // batches): the venture whose repo holds the cwd, else the box owner.
  // actor stays wire-writable — a batch that named an actor keeps it;
  // the server only fills the gap, and only for a session with a cwd (a
  // real run, never an abstract fixture), so the fill heals old blanks on
  // their next touch. It rides the return so caches hear it.
  let fill = host.prepare(
    'update session set actor = ? where entity = (select id from entity where eid = ?)',
  )
  let has = host.prepare(
    `select s.cwd as cwd, act.eid as actor from session s
       join entity o on o.id = s.entity
       left join entity act on act.id = s.actor
       where o.eid = ?`,
  )
  for (let eid of touched) {
    let s = has.get(eid) as
      | { cwd: string | null; actor: string | null }
      | undefined
    if (!s || s.actor || !s.cwd) continue
    let a = host.venture(s.cwd)
    if (a) {
      fill.run(host.id(a), eid)
      extra.push({ eid, name: 'session', comp: { actor: a } })
    }
  }
}

export let lifecycleAfter = (host: LifecycleHost, batch: LifecycleBatch) => {
  let {
    changes,
    extra,
    minted,
    createdComps,
    now,
    actor,
    via,
    person,
    writer,
    imports,
  } = batch
  let { stamps, clocked } = host
  let actorId = host.id(actor)
  let viaId = host.id(via)
  let alive = host.prepare(`select 1 from entity e where e.eid = ?
    and not exists (select 1 from tombstone t where t.entity = e.id)`)
  // A memory born of anything that is not a person lands PROPOSED
  // (M-31946): recallable and searchable, but no persona preloads it and
  // no index calls it accepted until a person decides. A person's own
  // memory is accepted as written. Server-stamped here so every door —
  // MCP, CLI, a raw /apply — says the same thing.
  if (!person()) {
    let propose = host.prepare(
      `insert or ignore into proposed (entity, at, "by", via)
         values ((select id from entity where eid = ?), ?, ?, ?)`,
    )
    for (let eid of minted) {
      if (!createdComps.has(`memory ${eid}`) || !alive.get(eid)) continue
      propose.run(eid, now, actorId, viaId)
      let row = host.component(eid, 'proposed')
      if (row) extra.push({ eid, name: 'proposed', comp: row })
    }
  }
  // The ingest coordinate (D-16704), stamped beside the entry it marks so
  // the pair (entry, imported) commits atomically. Only the trusted append
  // path passes `imports`; the wire never does. It rides `extra` (not the
  // `echoed` set below), so it reaches the journal and every replaying
  // cache — the coordinate is the durable cursor and must not be lost.
  if (imports) {
    let stampImported = host.prepare(
      `insert into imported (entity, source, line)
         values ((select id from entity where eid = ?), ?, ?)`,
    )
    for (let [eid, coord] of imports) {
      if (!alive.get(eid)) continue
      stampImported.run(eid, coord.source, coord.line)
      extra.push({ eid, name: 'imported', comp: { eid, ...coord } })
    }
  }
  // The stamp family (notified/opened/archived/decided/proposed): fill the
  // actor GAP
  // and stamp the instrument, on insert only — then re-read the row so an
  // optimistic cache never keeps a blank stamp. The created/updated re-read,
  // generalized to one small loop.
  //
  // `coalesce` is what lets one loop serve both halves of the family: a
  // notification stamp can't carry a wire `by` (the column isn't in comps),
  // so filling it is unconditional there; `decided` can, and a caller who
  // named the decider keeps it. Insert-only for the same reason `created`
  // is: correcting a decision's date later doesn't change who wrote it down,
  // and the correction is journaled anyway.
  for (let { eid, name, comp } of changes) {
    if (comp == null || !stamps.includes(name) || !alive.get(eid)) continue
    if (createdComps.has(`${name} ${eid}`)) {
      host.prepare(
        `update ${host.quote(name)} set "by" = coalesce("by", ?), via = ?
           where entity = (select id from entity where eid = ?)`,
      ).run(actorId, viaId, eid)
    }
    let row = host.component(eid, name)
    if (row) extra.push({ eid, name, comp: row })
  }
  // Clocked presence facets freeze their insertion time. Re-reading on every
  // effective presence write keeps an optimistic cache complete, while only
  // a delete followed by a fresh insert can move the clock.
  for (let { eid, name, comp } of changes) {
    if (comp == null || !clocked.includes(name) || !alive.get(eid)) continue
    if (createdComps.has(`${name} ${eid}`)) {
      host.prepare(
        `update ${host.quote(name)} set at = ?
           where entity = (select id from entity where eid = ?)`,
      ).run(now, eid)
    }
    let row = host.component(eid, name)
    if (row) extra.push({ eid, name, comp: row })
  }
  // The mail SENDER, derived. `from` is off the wire (types.ts), so this
  // is its only writer: a letter speaks as the actor that WROTE it, the
  // same resolution behind created.by. No caller can sign as anyone else
  // (T-9511), and nothing signs as the fleet default any more (T-9489).
  //
  // An actor with no address leaves `from` empty rather than failing the
  // batch — writing the graph is not sending, and a fixture that mints a
  // mail is not asking to deliver one. The refusal belongs at delivery,
  // where mailed() stamps the error onto the row and the board shows it.
  //
  // Inbound arrives through this door too (inbound.ts mint), and its
  // message_id — the never-send mark — is stamped just AFTER apply. So a
  // swept row is stamped here as well and corrected a moment later by that
  // same stamp, before dispatch hands anything to delivery. Only the
  // intermediate cast ever carries the derived value.
  let addrOf = host.prepare(
    'select address from email where entity = (select id from entity where eid = ?)',
  )
  let sender = host.prepare(
    'update mail set "from" = ? where entity = (select id from entity where eid = ?)',
  )
  for (let key of createdComps) {
    if (!key.startsWith('mail ')) continue
    let eid = key.slice(5)
    if (!alive.get(eid)) continue
    let signer = host.sender(writer)
    let addr = signer
      ? (addrOf.get(signer) as { address: string } | undefined)?.address
      : undefined
    if (!addr) continue
    sender.run(addr, eid)
    extra.push({ eid, name: 'mail', comp: { eid, from: addr } })
  }
}

export let syncFacetAliases = (
  host: LifecycleHost,
  changes: Change[],
  extra: Change[],
) => {
  let byEid = 'entity = (select id from entity where eid = ?)'
  for (let name of ['worktree', 'runtime'] as const) {
    let cols = host.facetCols(name)
    let eids = new Set(
      changes.filter((c) => c.name == name).map((c) => c.eid),
    )
    for (let eid of eids) {
      if (!host.prepare(`select 1 from session where ${byEid}`).get(eid)) {
        continue
      }
      let row = host.prepare(
        `select ${cols.map(host.quote).join(', ')} from ${host.quote(name)}
         where ${byEid}`,
      ).get(eid) as Record<string, unknown> | undefined
      let spec = row ?? Object.fromEntries(cols.map((col) => [col, null]))
      host.prepare(
        `update session set ${
          cols.map((col) => `${host.quote(col)} = ?`).join(', ')
        }
         where ${byEid}`,
      ).run(
        ...cols.map((col) => spec[col] as string | number | null ?? null),
        eid,
      )
      extra.push({ eid, name: 'session', comp: spec })
    }
  }
}
