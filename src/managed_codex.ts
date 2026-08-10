// Graph-native managed Codex sessions. A Session is an ordered entry
// partition; this service leases one ready generation or call, performs one
// bounded operation, and appends its outcome. Process-backed compatibility
// remains in sessions.ts and the Codex transport remains in responses.ts.
import { DatabaseSync } from 'node:sqlite'
import { apply, record } from './db.ts'
import {
  append,
  cancelEntry,
  expiredLeases,
  failEntry,
  type LeaseToken,
  readEntries,
  readyEntries,
  reclaimEntry,
  settleCall,
  settleGeneration,
  takeEntry,
} from './entries.ts'
import {
  executeCall,
  generate,
  type GenerationFault,
  instructions,
  type ResponseTransport,
} from './runner.ts'
import { type ToolHost } from './harness_tools.ts'
import { sessionRow } from './session_store.ts'
import { type Change, uuid } from './types.ts'

type Cast = (changes: Change[]) => void

export type ManagedJob = {
  instruction: string
  session_id: string
  task?: string
  role?: string
  repo: { path: string; base_branch: string }
  tree: string
  branch: string
  model: string
  effort?: string
}

export type ManagedCodexOptions = {
  db: DatabaseSync
  cast: Cast
  transport: ResponseTransport
  tools: (tree: string, session: string) => Promise<ToolHost>
  prepare: (eid: string, job: ManagedJob, cast: Cast) => Promise<void>
  clock?: () => Date
  leaseMs?: number
  runner?: string
}

let now = () => new Date()

export let graphSession = (db: DatabaseSync, eid: string) =>
  !!db.prepare('select 1 from entry where session = ? limit 1').get(eid)

export let graphBusy = (db: DatabaseSync, eid: string) =>
  !!db.prepare(
    `select 1 from entry e
     where e.session = ? and (
       exists (select 1 from lease l where l.eid = e.eid)
       or (
         not exists (select 1 from error x where x.eid = e.eid)
         and not exists (select 1 from cancel z where z.target = e.eid)
         and (
           (exists (select 1 from generation g where g.eid = e.eid)
            and not exists (select 1 from delivered d where d.eid = e.eid)
            and not exists (select 1 from output o where o.source = e.eid))
           or
           (exists (select 1 from call c where c.eid = e.eid)
            and not exists (select 1 from result r where r.call = e.eid))
         )
       )
     ) limit 1`,
  ).get(eid)

let pendingAttention = (db: DatabaseSync, session: string) =>
  !!db.prepare(
    `select 1 from entry a join attention n on n.eid = a.eid
     where a.session = ? and not exists (
       select 1 from entry e join generation g on g.eid = e.eid
       join entry t on t.eid = g.through
       where e.session = a.session and t.seq >= a.seq
     ) limit 1`,
  ).get(session)

// Attention carries no graph prose. The provider sees only runner.ts's fixed
// notice and must retrieve the exact pending items through task_context.
export let attention = (
  db: DatabaseSync,
  session: string,
  cast: Cast,
  writer?: string,
) => {
  if (!graphSession(db, session) || pendingAttention(db, session)) return []
  let source = writer ?? (db.prepare(
    "select eid from runner where name = 'tasksd' order by rowid limit 1",
  ).get() as { eid: string } | undefined)?.eid
  if (!source) throw new Error('managed Codex runner unavailable')
  let out = append(db, session, [{ attention: {} }], source).changes
  cast(out)
  return out
}

let delivered = (
  db: DatabaseSync,
  eid: string,
  via: string,
  cast: Cast,
  clock: () => Date,
) => {
  let at = clock().toISOString()
  let comp = { eid, at, via }
  db.prepare(
    `insert into delivered (eid, at, via) values (?, ?, ?)
     on conflict(eid) do update set at = excluded.at, via = excluded.via`,
  ).run(eid, at, via)
  let change: Change = { eid, name: 'delivered', comp }
  record(db, [change])
  cast([change])
}

let sessionError = (
  db: DatabaseSync,
  eid: string,
  message: string | null,
  cast: Cast,
  clock: () => Date,
) => {
  let changes: Change[] = []
  if (message == null) {
    if (db.prepare('delete from error where eid = ?').run(eid).changes) {
      changes.push({ eid, name: 'error', comp: null })
    }
  } else {
    let old = db.prepare('select message from error where eid = ?').get(eid) as
      | { message: string }
      | undefined
    if (old?.message == message) return
    let comp = { eid, at: clock().toISOString(), message }
    db.prepare(
      `insert into error (eid, at, message) values (?, ?, ?)
       on conflict(eid) do update set at = excluded.at,
         message = excluded.message`,
    ).run(eid, comp.at, message)
    changes.push({ eid, name: 'error', comp })
  }
  if (changes.length) {
    record(db, changes)
    cast(changes)
  }
}

let rowOf = (db: DatabaseSync, eid: string) =>
  readEntries(
    db,
    String(
      (db.prepare('select session from entry where eid = ?').get(eid) as {
        session: string
      }).session,
    ),
  ).find((row) => row.eid == eid)!

let sessions = (db: DatabaseSync) =>
  (db.prepare('select distinct session from entry order by session').all() as {
    session: string
  }[]).map((row) => row.session)

let laterGeneration = (
  db: DatabaseSync,
  session: string,
  seq: number,
) =>
  !!db.prepare(
    `select 1 from entry e join generation g on g.eid = e.eid
     where e.session = ? and e.seq > ? limit 1`,
  ).get(session, seq)

let advance = (
  db: DatabaseSync,
  session: string,
  cast: Cast,
  writer: string,
) => {
  let entries = readEntries(db, session)
  let generation = entries.filter((row) => row.comps.generation).at(-1)
  if (!generation || laterGeneration(db, session, generation.seq)) return false
  if (generation.comps.lease) return false
  let cancelled = entries.some((row) =>
    row.comps.cancel?.target == generation.eid
  )
  let failed = !!generation.comps.error || cancelled
  if (!generation.comps.delivered && !failed) return false
  let outputs = entries.filter((row) =>
    row.comps.output?.source == generation.eid
  )
  let calls = outputs.filter((row) => row.comps.call)
  let done = calls.every((call) =>
    entries.some((row) => row.comps.result?.call == call.eid) ||
    call.comps.error ||
    entries.some((row) => row.comps.cancel?.target == call.eid)
  )
  let edge =
    entries.find((row) => row.eid == generation.comps.generation.through)
      ?.seq ?? generation.seq
  let input = entries.some((row) =>
    row.seq > edge &&
    (row.comps.attention ||
      (row.comps.message?.role == 'user' && !row.comps.output))
  )
  if (!done || (!input && (failed || !calls.length))) return false
  let through = entries.at(-1)!.eid
  let value = generation.comps.generation
  let out = append(db, session, [{
    generation: {
      through,
      provider: value.provider,
      model: value.model,
      ...value.effort ? { effort: value.effort } : {},
    },
  }], writer).changes
  cast(out)
  return true
}

let valid = (db: DatabaseSync, token: LeaseToken) =>
  !!db.prepare(
    `select 1 from lease l where l.eid = ? and l.holder = ? and l.at = ?
     and not exists (select 1 from cancel c where c.target = l.eid)`,
  ).get(token.eid, token.holder, token.at)

export let managedCodex = (options: ManagedCodexOptions) => {
  let db = options.db
  let cast = options.cast
  let clock = options.clock ?? now
  let leaseMs = Math.max(100, options.leaseMs ?? 60_000)
  let runner = options.runner ?? String(
    (db.prepare("select eid from runner where name = 'tasksd' limit 1").get() as
      | { eid: string }
      | undefined)?.eid ?? uuid(),
  )
  let blocked = new Set<string>()
  let prepared = new Set<string>()
  let flights = new Map<
    string,
    { session: string; control: AbortController }
  >()
  let sweeping: Promise<void> | undefined
  let starting = new Map<string, Promise<void>>()
  let wake = false

  if (!db.prepare('select 1 from runner where eid = ?').get(runner)) {
    cast(apply(db, [{
      eid: runner,
      name: 'runner',
      comp: { name: 'tasksd' },
    }]))
  }

  let generation = async (token: LeaseToken, session: string) => {
    let control = new AbortController()
    flights.set(token.eid, { session, control })
    let tools: ToolHost | undefined
    try {
      let row = sessionRow(db, session)
      if (!row?.cwd) throw new Error('managed Codex session has no worktree')
      tools = await options.tools(String(row.cwd), session)
      let work = await generate({
        entries: readEntries(db, session),
        generation: token.eid,
        instructions: await instructions({ tree: String(row.cwd) }),
        transport: options.transport,
        tools: tools.tools,
        signal: control.signal,
        cacheKey: session,
      })
      if (!valid(db, token)) return
      if (work.specs.length) {
        cast(append(db, session, work.specs, runner).changes)
      }
      cast(settleGeneration(db, token, work.usage, clock, work.model))
      sessionError(db, session, null, cast, clock)
    } catch (error) {
      if (!valid(db, token)) return
      let evidence = (error as GenerationFault).entrySpecs ?? []
      if (evidence.length) cast(append(db, session, evidence, runner).changes)
      let message = String((error as Error).message).slice(0, 2000)
      cast(failEntry(db, token, message, clock))
      sessionError(db, session, message, cast, clock)
    } finally {
      flights.delete(token.eid)
      await tools?.close?.()
    }
  }

  let call = async (token: LeaseToken, session: string) => {
    let control = new AbortController()
    flights.set(token.eid, { session, control })
    let tools: ToolHost | undefined
    try {
      let row = sessionRow(db, session)
      if (!row?.cwd) throw new Error('managed Codex session has no worktree')
      tools = await options.tools(String(row.cwd), session)
      let spec = await executeCall(rowOf(db, token.eid), tools, control.signal)
      if (!valid(db, token)) return
      cast(append(db, session, [spec], runner).changes)
      cast(settleCall(db, token))
    } catch (error) {
      if (!valid(db, token)) return
      let message = String((error as Error).message).slice(0, 2000)
      cast(failEntry(db, token, message, clock))
      sessionError(db, session, message, cast, clock)
    } finally {
      flights.delete(token.eid)
      await tools?.close?.()
    }
  }

  let expire = () => {
    let retries: {
      session: string
      token: LeaseToken
      kind: 'generation' | 'call'
    }[] = []
    for (let lease of expiredLeases(db, clock().toISOString())) {
      if (flights.has(lease.eid)) continue
      if (
        db.prepare('select 1 from generation where eid = ?').get(lease.eid) &&
        db.prepare('select 1 from output where source = ? limit 1').get(
          lease.eid,
        )
      ) {
        let settled = settleGeneration(db, lease, undefined, clock)
        if (settled.length) {
          cast(settled)
          sessionError(db, lease.session, null, cast, clock)
          continue
        }
      }
      if (
        db.prepare('select 1 from call where eid = ?').get(lease.eid) &&
        db.prepare('select 1 from result where call = ? limit 1').get(
          lease.eid,
        )
      ) {
        let settled = settleCall(db, lease)
        if (settled.length) {
          cast(settled)
          sessionError(db, lease.session, null, cast, clock)
          continue
        }
      }
      let won = reclaimEntry(db, lease, runner, leaseMs, clock)
      if (won) {
        cast(won.changes)
        retries.push({
          session: lease.session,
          token: won.token,
          kind: won.kind,
        })
        continue
      }
      let message = 'runner disappeared; operation outcome is ambiguous'
      cast(failEntry(db, lease, message, clock))
      sessionError(db, lease.session, message, cast, clock)
    }
    return retries
  }

  let runnable = (session: string) =>
    prepared.has(session) ||
    !!sessionRow(db, session)?.base_revision

  let pass = async () => {
    let recovered = expire()
    let moved = false
    for (let session of sessions(db)) {
      if (!blocked.has(session) && runnable(session)) {
        moved = advance(db, session, cast, runner) || moved
      }
    }
    let ready = sessions(db).flatMap((session) =>
      blocked.has(session) ||
        !runnable(session)
        ? []
        : readyEntries(db, session).map((entry) => ({ session, ...entry }))
    )
    let jobs = recovered.map(({ session, token, kind }) =>
      kind == 'generation' ? generation(token, session) : call(token, session)
    )
    jobs.push(...ready.flatMap(({ session, eid }) => {
      let won = takeEntry(db, eid, runner, leaseMs, clock)
      if (!won) return []
      cast(won.changes)
      let kind = db.prepare('select 1 from generation where eid = ?').get(eid)
      return [kind ? generation(won.token, session) : call(won.token, session)]
    }))
    await Promise.all(jobs)
    return moved || jobs.length > 0
  }

  let sweep = () => {
    if (sweeping) {
      wake = true
      return sweeping
    }
    sweeping = (async () => {
      try {
        do {
          wake = false
          while (await pass()) { /* drain to an idle boundary */ }
        } while (wake)
      } finally {
        sweeping = undefined
      }
    })()
    return sweeping
  }

  let startOne = async (eid: string, job: ManagedJob) => {
    blocked.add(eid)
    let rows = readEntries(db, eid)
    let input = rows.find((row) =>
      row.comps.message?.role == 'user' && !row.comps.output
    )?.eid
    let generation = rows.find((row) => row.comps.generation)?.eid
    if (!input) {
      input = uuid()
      generation = uuid()
      let first = append(
        db,
        eid,
        [{
          message: { role: 'user' },
          content: { body: job.instruction },
        }, {
          generation: {
            through: input,
            provider: 'codex',
            model: job.model,
            ...job.effort ? { effort: job.effort } : {},
          },
        }],
        runner,
        [input, generation],
      )
      cast(first.changes)
    } else if (!generation) {
      let made = append(db, eid, [{
        generation: {
          through: input,
          provider: 'codex',
          model: job.model,
          ...job.effort ? { effort: job.effort } : {},
        },
      }], runner)
      generation = made.eids[0]
      cast(made.changes)
    }
    try {
      let state = sessionRow(db, eid)
      if (!state?.base_revision) await options.prepare(eid, job, cast)
      prepared.add(eid)
    } catch (error) {
      let won = takeEntry(db, generation!, runner, leaseMs, clock)
      let message = String(error).slice(0, 2000)
      if (won) {
        cast(won.changes)
        cast(failEntry(db, won.token, message, clock))
      }
      sessionError(db, eid, message, cast, clock)
      return
    } finally {
      blocked.delete(eid)
    }
    await sweep()
  }

  let start = (eid: string, job: ManagedJob) => {
    let running = starting.get(eid)
    if (running) return running
    running = startOne(eid, job).finally(() => starting.delete(eid))
    starting.set(eid, running)
    return running
  }

  let stop = (
    request: string,
    session: string,
  ) => {
    if (!graphSession(db, session)) return false
    let work = new Map<string, { eid: string }>(
      readyEntries(db, session).map((row) => [row.eid, row]),
    )
    for (
      let row of db.prepare(
        `select e.eid from entry e join lease l on l.eid = e.eid
         where e.session = ?`,
      ).all(session) as { eid: string }[]
    ) work.set(row.eid, row)
    let targets = [...work.values()].filter((row) =>
      !db.prepare('select 1 from cancel where target = ?').get(row.eid)
    )
    if (targets.length) {
      cast(
        append(
          db,
          session,
          targets.map((row) => ({ cancel: { target: row.eid } })),
          runner,
        ).changes,
      )
    }
    for (let row of targets) flights.get(row.eid)?.control.abort()
    for (let row of targets) {
      let lease = db.prepare('select * from lease where eid = ?').get(
        row.eid,
      ) as LeaseToken | undefined
      if (lease) cast(cancelEntry(db, lease))
    }
    delivered(db, request, 'cancelled', cast, clock)
    return true
  }

  let comment = (target: string, ceid: string) => {
    let held = db.prepare('select session from claim where eid = ?').get(
      target,
    ) as { session: string } | undefined
    let eid = graphSession(db, target) ? target : held?.session
    if (!eid || !graphSession(db, eid)) return false
    let made = db.prepare('select via from created where eid = ?').get(ceid) as
      | { via: string | null }
      | undefined
    if (made?.via == eid) return true
    let row = db.prepare('select role from session where eid = ?').get(eid) as
      | { role: string | null }
      | undefined
    // Role reconciliation owns direct role inbox wake-ups. Claimed work is
    // narrower and belongs to the holder immediately, role or not.
    if (target == eid && row?.role) return true
    attention(db, eid, cast, runner)
    sweep()
    return true
  }

  let remove = (eid: string) => {
    for (let flight of flights.values()) {
      if (flight.session == eid) flight.control.abort()
    }
  }

  return { runner, start, stop, comment, remove, sweep }
}
