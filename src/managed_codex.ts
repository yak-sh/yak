// The provider-neutral graph-native Session scheduler. A Session is an ordered
// entry partition; this service leases one ready generation or call, performs
// one bounded operation, and appends its outcome. A generation dispatches by
// its `generation.provider` to a GenerationRunner (runner.ts) — today only
// Codex; a bounded `claude -p` is a sibling entry. Everything else — entry
// readiness, leases, hosted calls, worktree preparation, attention, and stop —
// is provider-agnostic. Process-backed compatibility remains in sessions.ts.
import type { Sql } from './store/sql.ts'
import { apply, record } from './db.ts'
import {
  append,
  cancelEntry,
  expiredLeases,
  failEntry,
  type LeaseToken,
  readEntries,
  readEntry,
  readReplay,
  readyEntries,
  reclaimEntry,
  renewEntry,
  settleCall,
  settleGeneration,
  takeEntry,
} from './entries.ts'
import {
  codexGeneration,
  executeCall,
  type GenerationFault,
  type GenerationRunner,
  type ResponseTransport,
} from './runner.ts'
import { claudeGeneration } from './claude_print.ts'
import { type ToolHost } from './harness_tools.ts'
import { type Observation } from './observations.ts'
import { sessionRow } from './session_store.ts'
import { type Change, uuid } from './types.ts'

type Cast = (changes: Change[]) => void

// A component row is keyed by its owner's internal int id (D-18866); a consumer
// that matched by owner eid uses this correlated lookup, its bound eid param
// unchanged. `entity` here is the component table's owner column.
let OWNED = `entity = (select id from entity where eid = ?)`

export type ManagedJob = {
  // Persona and prompt are seeded as two ordered entries (T-18991); a job that
  // carries neither (a resume/reconfigure) falls back to the single
  // `prompt` entry.
  persona?: string
  prompt?: string
  instruction: string
  session_id: string
  task?: string
  role?: string
  repo?: { path: string; base_branch: string }
  tree?: string
  branch?: string
  model: string
  effort?: string
}

type ManagedWorkspaceJob = ManagedJob & {
  repo: { path: string; base_branch: string }
  tree: string
  branch: string
}

export type ManagedCodexOptions = {
  db: Sql
  cast: Cast
  transport: ResponseTransport
  tools: (tree: string | undefined, session: string) => Promise<ToolHost>
  prepare: (
    eid: string,
    job: ManagedWorkspaceJob,
    cast: Cast,
  ) => Promise<void>
  clock?: () => Date
  leaseMs?: number
  runner?: string
  observe?: (observation: Observation) => void
  // Provider runners layered over the built-in dispatch (codex + claude). A
  // seam for routing (T-16817) and the acceptance canary (T-16818) to inject a
  // claude runner with a stubbed subprocess; absent, the defaults stand.
  generators?: Record<string, GenerationRunner>
}

let now = () => new Date()

// A session is graph-native when the runner minted a generation for it. Other
// graph-born entries are not execution markers: auto-recall appends `recalled`
// entries to process-backed transcripts, and comments may append `attention`.
// Imported generations (D-16704) remain file history. The generation is the
// durable execution boundary runnerSessions() already drives from below.
export let graphSession = (db: Sql, eid: string) =>
  !!db.prepare(
    `select 1 from entry e join generation g on g.entity = e.entity
     where e.session = (select id from entity where eid = ?)
       and not exists (select 1 from imported i where i.entity = g.entity)
     limit 1`,
  ).get(eid)

// Ready-or-leased runner work, imported history excluded on both arms — an
// imported call without a correlated result (a claude tool_use whose result
// line hasn't landed, a codex web_search that has none) is settled file
// history, never a pending operation for the runner to lease.
export let graphBusy = (db: Sql, eid: string) =>
  !!db.prepare(
    `select 1 from entry e
     where e.session = (select id from entity where eid = ?) and (
       exists (select 1 from lease l where l.entity = e.entity)
       or (
         not exists (select 1 from imported i where i.entity = e.entity)
         and not exists (select 1 from error x where x.entity = e.entity)
         and not exists (select 1 from cancel z where z.target = e.entity)
         and (
           (exists (select 1 from generation g where g.entity = e.entity)
            and not exists (select 1 from delivered d where d.entity = e.entity)
            and not exists (select 1 from output o where o.source = e.entity))
           or
           (exists (select 1 from call c where c.entity = e.entity)
            and not exists (select 1 from result r where r.call = e.entity))
         )
       )
     ) limit 1`,
  ).get(eid)

let pendingAttention = (db: Sql, session: string) =>
  !!db.prepare(
    `select 1 from entry a join attention n on n.entity = a.entity
     where a.session = (select id from entity where eid = ?) and not exists (
       select 1 from entry e join generation g on g.entity = e.entity
       join entry t on t.entity = g.through
       where e.session = a.session and t.seq >= a.seq
     ) limit 1`,
  ).get(session)

// Attention carries no graph prose. The provider sees only runner.ts's fixed
// notice and must retrieve the exact pending items through task_context.
export let attention = (
  db: Sql,
  session: string,
  cast: Cast,
  writer?: string,
) => {
  if (!graphSession(db, session) || pendingAttention(db, session)) return []
  let source = writer ?? (db.prepare(
    `select o.eid as eid from runner r join entity o on o.id = r.entity
     where r.name = 'tasksd' order by r.rowid limit 1`,
  ).get() as { eid: string } | undefined)?.eid
  if (!source) throw new Error('managed session runner unavailable')
  let out = append(db, session, [{ attention: {} }], source).changes
  cast(out)
  return out
}

let delivered = (
  db: Sql,
  eid: string,
  via: string,
  cast: Cast,
  clock: () => Date,
) => {
  let at = clock().toISOString()
  let comp = { eid, at, via }
  db.prepare(
    `insert into delivered (entity, at, via)
       values ((select id from entity where eid = ?), ?, ?)
     on conflict(entity) do update set at = excluded.at, via = excluded.via`,
  ).run(eid, at, via)
  let change: Change = { eid, name: 'delivered', comp }
  record(db, [change])
  cast([change])
}

// A managed Session's health (D-17077, T-17081). A fault reaching here is
// always a genuine BREAK — a generation or call that threw PAST the cancel gate
// (valid() screens a stop before this), a vanished runner, a failed prepare —
// so it wears the `exception` facet (the self-healing trigger), never `error`.
// No live heal fires from here: excepted()'s dispatch door reads deliver.ts's
// SINGLETON db, which this runner is not under test, so the break rides the
// narrow table door and the boot sweep (HEAL_PENDING) files its deduped bug.
// That is the RIGHT floor, not a shortcut — a break that self-recovers clears
// the facet (below) before any boot, so only an UNRECOVERED one is ever filed.
// A clean turn sheds both facets so a recovered Session reads well.
let sessionFault = (
  db: Sql,
  eid: string,
  fault: string | null,
  cast: Cast,
  clock: () => Date,
) => {
  let changes: Change[] = []
  if (fault == null) {
    if (
      db.prepare(`delete from error where ${OWNED}`).run(eid).changes
    ) {
      changes.push({ eid, name: 'error', comp: null })
    }
    if (
      db.prepare(`delete from exception where ${OWNED}`).run(eid).changes
    ) {
      changes.push({ eid, name: 'exception', comp: null })
    }
  } else {
    let old = db.prepare(`select message from exception where ${OWNED}`).get(
      eid,
    ) as { message: string } | undefined
    if (old?.message == fault) return
    let comp = { eid, at: clock().toISOString(), message: fault, stack: null }
    db.prepare(
      `insert into exception (entity, at, message, stack)
         values ((select id from entity where eid = ?), ?, ?, null)
       on conflict(entity) do update set at = excluded.at,
         message = excluded.message`,
    ).run(eid, comp.at, fault)
    changes.push({ eid, name: 'exception', comp })
  }
  if (changes.length) {
    record(db, changes)
    cast(changes)
  }
}

// A runner pass starts from generations: startOne() mints one before it makes
// a Session runnable, and every later generation advances from that chain.
// Imported generations are file history, never work. Driving this from every
// entry partition makes an archive import multiply each 300 ms pass by every
// historical Session even though none can produce a runnable operation.
export let runnerSessions = (db: Sql) =>
  (db.prepare(
    `select distinct (select eid from entity where id = e.session) as session
     from generation g cross join entry e
     left join imported i on i.entity = g.entity
     where e.entity = g.entity and i.entity is null
     order by e.session`,
  ).all() as { session: string }[]).map((row) => row.session)

export let advanceable = (db: Sql) =>
  db.prepare(`
    with latest as (
      select e.session, max(e.seq) as seq
      from generation g cross join entry e
      left join imported i on i.entity = g.entity
      where e.entity = g.entity and i.entity is null
      group by e.session
    ), current as (
      select e.session, e.entity as entity, e.seq, g.through,
             g.provider, g.model, g.effort
      from latest l
      join entry e on e.session = l.session and e.seq = l.seq
      join generation g on g.entity = e.entity
    )
    select (select eid from entity where id = c.session) as session,
           c.provider, c.model, c.effort,
           (select ee.eid from entry z join entity ee on ee.id = z.entity
            where z.session = c.session
            order by z.seq desc limit 1) as through
    from current c
    where not exists (select 1 from lease l where l.entity = c.entity)
      and (
        exists (select 1 from delivered d where d.entity = c.entity)
        or exists (select 1 from error x where x.entity = c.entity)
        or exists (select 1 from cancel z where z.target = c.entity)
      )
      and not exists (
        select 1 from output o join call k on k.entity = o.entity
        where o.source = c.entity
          and not exists (select 1 from result r where r.call = k.entity)
          and not exists (select 1 from error x where x.entity = k.entity)
          and not exists (select 1 from cancel z where z.target = k.entity)
      )
      and (
        exists (
          select 1 from entry n
          where n.session = c.session
            and n.seq > coalesce(
              (select t.seq from entry t where t.entity = c.through), c.seq
            )
            and (
              exists (select 1 from attention a where a.entity = n.entity)
              or (
                exists (select 1 from message m
                        where m.entity = n.entity and m.role = 'user')
                and not exists (select 1 from output o where o.entity = n.entity)
              )
            )
        )
        or (
          not exists (select 1 from error x where x.entity = c.entity)
          and not exists (select 1 from cancel z where z.target = c.entity)
          and exists (
            select 1 from output o join call k on k.entity = o.entity
            where o.source = c.entity
          )
        )
      )
    order by c.session
  `).all() as {
    session: string
    through: string
    provider: string
    model: string
    effort: string | null
  }[]

let advance = (
  db: Sql,
  cast: Cast,
  writer: string,
  eligible: (session: string) => boolean,
) => {
  let ready = advanceable(db).filter((row) => eligible(row.session))
  for (let row of ready) {
    let out = append(db, row.session, [{
      generation: {
        through: row.through,
        provider: row.provider,
        model: row.model,
        ...row.effort ? { effort: row.effort } : {},
      },
    }], writer).changes
    cast(out)
  }
  return ready.length > 0
}

let valid = (db: Sql, token: LeaseToken) =>
  !!db.prepare(
    `select 1 from lease l
     where l.entity = (select id from entity where eid = ?)
       and l.holder = (select id from entity where eid = ?)
       and l.at = ?
       and not exists (select 1 from cancel c where c.target = l.entity)`,
  ).get(token.eid, token.holder, token.at)

export let managedCodex = (options: ManagedCodexOptions) => {
  let db = options.db
  let cast = options.cast
  let clock = options.clock ?? now
  let leaseMs = Math.max(100, options.leaseMs ?? 60_000)
  let runner = options.runner ?? String(
    (db.prepare(
      `select o.eid as eid from runner r join entity o on o.id = r.entity
       where r.name = 'tasksd' limit 1`,
    ).get() as
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
  let draining = false
  let expiry: ReturnType<typeof setTimeout> | undefined

  // While an operation is in flight, keep its lease fresh so a restart never
  // mistakes a turn that outlives the base TTL for a dead runner and reclaims
  // or fails an operation this process is still running. Renewal leaves the
  // holder+at CAS untouched, so this runner's own settle/valid path is
  // unaffected; the interval is cleared the moment the operation settles.
  let beat = (token: LeaseToken) => {
    let timer = setInterval(() => {
      try {
        let renewed = renewEntry(db, token, leaseMs, clock)
        if (renewed) cast(renewed.changes)
        else clearInterval(timer)
      } catch (error) {
        console.warn('managed lease renewal —', error)
      }
    }, Math.max(50, Math.floor(leaseMs / 2)))
    return () => clearInterval(timer)
  }

  // Watching is auxiliary: a broken observer must never break or retry the
  // provider operation whose durable outcome the graph still needs.
  let observe = (value: Observation) => {
    try {
      options.observe?.(value)
    } catch (error) {
      console.warn('managed observation dropped —', error)
    }
  }

  if (!db.prepare(`select 1 from runner where ${OWNED}`).get(runner)) {
    cast(apply(db, [{
      eid: runner,
      name: 'runner',
      comp: { name: 'tasksd' },
    }]))
  }

  // The generation dispatcher: one entry per provider, selected by a
  // generation's `provider`. Codex runs the Responses transport + hosted tools;
  // Claude runs a bounded `claude -p` subprocess that executes its OWN tools
  // in-process (claude_print.ts, T-16814). Both satisfy one GenerationRunner
  // contract, so nothing in the scheduling below learns a provider's dialect.
  let generators: Record<string, GenerationRunner> = {
    codex: codexGeneration(options.transport),
    claude: claudeGeneration(),
    ...options.generators,
  }

  let generation = async (token: LeaseToken, session: string) => {
    let control = new AbortController()
    flights.set(token.eid, { session, control })
    let stop = beat(token)
    let tools: ToolHost | undefined
    let clear = false
    try {
      let entries = readReplay(db, token.eid)
      let provider = String(
        entries.find((row) => row.eid == token.eid)?.comps.generation
          ?.provider ?? '',
      )
      let run = generators[provider]
      if (!run) throw new Error(`no managed runner for provider '${provider}'`)
      let row = sessionRow(db, session)
      let tree = row?.cwd ? String(row.cwd) : undefined
      tools = await options.tools(tree, session)
      let work = await run({
        entries,
        generation: token.eid,
        tree,
        tools,
        signal: control.signal,
        cacheKey: session,
        emit: (delta) => {
          if (!valid(db, token)) return
          observe({ session, generation: token.eid, ...delta })
        },
      })
      if (!valid(db, token)) return
      if (work.specs.length) {
        // work.ids preserves a runner's pre-minted eids so an intra-batch
        // reference (Claude's tool_result → its tool_use) survives the append;
        // codex omits them and append mints.
        cast(append(db, session, work.specs, runner, work.ids).changes)
      }
      cast(settleGeneration(db, token, work.usage, clock, work.model))
      sessionFault(db, session, null, cast, clock)
      clear = true
    } catch (error) {
      if (!valid(db, token)) return
      let evidence = (error as GenerationFault).entrySpecs ?? []
      if (evidence.length) cast(append(db, session, evidence, runner).changes)
      let message = String((error as Error).message).slice(0, 2000)
      cast(failEntry(db, token, message, clock))
      sessionFault(db, session, message, cast, clock)
      clear = true
    } finally {
      stop()
      if (clear) observe({ session, generation: token.eid, kind: 'clear' })
      flights.delete(token.eid)
      await tools?.close?.()
    }
  }

  let call = async (token: LeaseToken, session: string) => {
    let control = new AbortController()
    flights.set(token.eid, { session, control })
    let stop = beat(token)
    let tools: ToolHost | undefined
    try {
      let row = sessionRow(db, session)
      let tree = row?.cwd ? String(row.cwd) : undefined
      tools = await options.tools(tree, session)
      let entry = readEntry(db, token.eid)
      if (!entry) throw new Error('no call entry')
      let spec = await executeCall(entry, tools, control.signal)
      if (!valid(db, token)) return
      cast(append(db, session, [spec], runner).changes)
      cast(settleCall(db, token))
    } catch (error) {
      if (!valid(db, token)) return
      let message = String((error as Error).message).slice(0, 2000)
      cast(failEntry(db, token, message, clock))
      sessionFault(db, session, message, cast, clock)
    } finally {
      stop()
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
        db.prepare(`select 1 from generation where ${OWNED}`).get(lease.eid) &&
        db.prepare(
          `select 1 from output
           where source = (select id from entity where eid = ?) limit 1`,
        ).get(
          lease.eid,
        )
      ) {
        let settled = settleGeneration(db, lease, undefined, clock)
        if (settled.length) {
          cast(settled)
          sessionFault(db, lease.session, null, cast, clock)
          continue
        }
      }
      if (
        db.prepare(`select 1 from call where ${OWNED}`).get(lease.eid) &&
        db.prepare(
          `select 1 from result
           where call = (select id from entity where eid = ?) limit 1`,
        ).get(
          lease.eid,
        )
      ) {
        let settled = settleCall(db, lease)
        if (settled.length) {
          cast(settled)
          sessionFault(db, lease.session, null, cast, clock)
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
      sessionFault(db, lease.session, message, cast, clock)
    }
    return retries
  }

  let runnable = (session: string) => {
    let row = sessionRow(db, session)
    // A no-code Session has nothing to prepare, so the absence of a cwd is
    // its durable ready fact. `prepared` only bridges workspace preparation
    // until base_revision is stamped; neither in-memory state may strand a
    // projectless conversation after a server restart.
    return prepared.has(session) || !!row?.base_revision || !row?.cwd
  }

  // Writes drive the runner immediately. Time only matters for abandoned
  // leases, so arm one deadline for the next lease this process does not own
  // instead of polling every partition to ask whether time passed.
  let arm = () => {
    clearTimeout(expiry)
    expiry = undefined
    if (draining || !db.isOpen) return
    let leases = db.prepare(
      `select o.eid as eid, l.until from lease l
       join entity o on o.id = l.entity order by l.until`,
    )
      .all() as { eid: string; until: string }[]
    let next = leases.find((row) => !flights.has(row.eid))
    if (!next) return
    let delay = Math.max(0, Date.parse(next.until) - clock().getTime())
    expiry = setTimeout(() => {
      expiry = undefined
      if (db.isOpen) {
        sweep().catch((error) => console.warn('managed lease expiry —', error))
      }
    }, Math.min(delay, 2_147_483_647))
    Deno.unrefTimer(expiry)
  }

  let pass = async () => {
    // Draining acquires no new work: the in-flight jobs of the pass that
    // started them are still awaited by that pass, so the current sweep drains
    // to a settled boundary and stops, leaving any newly-ready entry for the
    // successor. Every acquisition point below is gated by this one return.
    if (draining) return false
    let recovered = expire()
    let moved = advance(
      db,
      cast,
      runner,
      (session) => !blocked.has(session) && runnable(session),
    )
    let sessions = runnerSessions(db)
    let ready = sessions.flatMap((session) =>
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
      let kind = db.prepare(`select 1 from generation where ${OWNED}`).get(eid)
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
        arm()
      }
    })()
    return sweeping
  }

  // Shutdown drain: stop taking new work, then let every in-flight generation
  // and call finish and release its lease, so a restart hands the successor a
  // settled boundary instead of an operation killed mid-flight. Bounded so a
  // wedged stream cannot hold the process exit open forever — that residue
  // falls to crash recovery (T-16886), which no drain can prevent anyway.
  let settle = async (timeoutMs = 300_000) => {
    draining = true
    clearTimeout(expiry)
    if (!sweeping) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let bound = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, Math.max(0, timeoutMs))
    })
    try {
      await Promise.race([sweeping, bound])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  let startOne = async (eid: string, job: ManagedJob) => {
    blocked.add(eid)
    let state = sessionRow(db, eid)
    // The first generation carries the session's requested provider, so the
    // dispatcher routes every later turn (advance() copies it forward).
    let provider = String(state?.provider ?? 'codex')
    let rows = readEntries(db, eid)
    // The generation reads `through` the LAST user entry, so its window spans
    // every seeded user entry — the persona AND the prompt (T-18991).
    let input = rows.filter((row) =>
      row.comps.message?.role == 'user' && !row.comps.output
    ).at(-1)?.eid
    let generation = rows.find((row) => row.comps.generation)?.eid
    if (!input) {
      // The always-first user entries: the persona wears the `prompt`
      // facet so every transcript face folds it collapsed (T-18991); the
      // prompt is a plain user entry, shown. A job that carries neither part
      // (a resume/reconfigure, an unsplit test job) falls back to a single
      // `prompt` entry holding the whole prompt.
      let seeds = [
        job.persona && { body: job.persona, mark: true },
        job.prompt && { body: job.prompt },
      ].filter((s): s is { body: string; mark?: boolean } => !!s)
      if (seeds.length == 0) seeds = [{ body: job.instruction, mark: true }]
      let entries = seeds.map((seed) => ({
        ...(seed.mark ? { prompt: {} } : {}),
        message: { role: 'user' },
        content: { body: seed.body },
      }))
      let inputs = entries.map(() => uuid())
      input = inputs.at(-1)!
      generation = uuid()
      let first = append(
        db,
        eid,
        [...entries, {
          generation: {
            through: input,
            provider,
            model: job.model,
            ...job.effort ? { effort: job.effort } : {},
          },
        }],
        runner,
        [...inputs, generation],
      )
      cast(first.changes)
    } else if (!generation) {
      let made = append(db, eid, [{
        generation: {
          through: input,
          provider,
          model: job.model,
          ...job.effort ? { effort: job.effort } : {},
        },
      }], runner)
      generation = made.eids[0]
      cast(made.changes)
    }
    try {
      if (job.tree || job.repo || job.branch) {
        if (!job.tree || !job.repo || !job.branch) {
          throw new Error('managed session workspace is incomplete')
        }
        if (!state?.base_revision) {
          await options.prepare(eid, {
            ...job,
            tree: job.tree,
            repo: job.repo,
            branch: job.branch,
          }, cast)
        }
      }
      prepared.add(eid)
    } catch (error) {
      let won = takeEntry(db, generation!, runner, leaseMs, clock)
      let message = String(error).slice(0, 2000)
      if (won) {
        cast(won.changes)
        cast(failEntry(db, won.token, message, clock))
      }
      sessionFault(db, eid, message, cast, clock)
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
        `select o.eid as eid from entry e
         join entity o on o.id = e.entity
         join lease l on l.entity = e.entity
         where e.session = (select id from entity where eid = ?)`,
      ).all(session) as { eid: string }[]
    ) work.set(row.eid, row)
    let targets = [...work.values()].filter((row) =>
      !db.prepare(
        `select 1 from cancel where target = (select id from entity where eid = ?)`,
      ).get(row.eid)
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
      let lease = db.prepare(
        `select o.eid as eid,
                (select eid from entity where id = l.holder) as holder,
                l.at, l.until
         from lease l join entity o on o.id = l.entity
         where l.entity = (select id from entity where eid = ?)`,
      ).get(
        row.eid,
      ) as LeaseToken | undefined
      if (lease) {
        let cancelled = cancelEntry(db, lease)
        cast(cancelled)
        if (
          cancelled.length &&
          db.prepare(`select 1 from generation where ${OWNED}`).get(row.eid)
        ) observe({ session, generation: row.eid, kind: 'clear' })
      }
    }
    delivered(db, request, 'cancelled', cast, clock)
    return true
  }

  // Claimed work is the address. A direct graph-native session target stays as
  // migration compatibility; either route appends only content-free attention,
  // and task_context retrieves the graph words at the next boundary.
  let comment = (target: string, ceid: string) => {
    let held = db.prepare(
      `select (select eid from entity where id = c.session) as session
       from claim c where c.${OWNED}`,
    ).get(
      target,
    ) as { session: string } | undefined
    let eid = graphSession(db, target) ? target : held?.session
    if (!eid || !graphSession(db, eid)) return false
    let made = db.prepare(
      `select (select eid from entity where id = cr.via) as via
       from created cr where cr.${OWNED}`,
    ).get(ceid) as
      | { via: string | null }
      | undefined
    if (made?.via == eid) return true
    let row = db.prepare(
      `select (select eid from entity where id = s.role) as role
       from session s where s.${OWNED}`,
    ).get(eid) as
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

  return { runner, start, stop, comment, remove, sweep, settle }
}
