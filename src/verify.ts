// The verifier role's spawn engine (D-25036). Verification state itself lives
// in verification.ts; this module applies the graph-configured system-role
// gates and mints one independently-personaed Session for an eligible task.
// It deliberately registers no effects or commands — doing.ts owns that
// curated wiring in the next task.
import { apply, locate, readComp } from './db.ts'
import { db } from './live_db.ts'
import { spawnChanges } from './client.ts'
import { rowsFor } from './graph_query.ts'
import { commitEffects } from './effects.ts'
import { type Change } from './types.ts'
import type { SystemSpec, SystemTuning } from './roles.ts'
import {
  verificationArgs,
  verificationPending,
  VERIFY_PENDING,
} from './verification.ts'

type Cast = (changes: Change[]) => void
let OWNED = `entity = (select id from entity where eid = ?)`
let idOf = `(select id from entity where eid = ?)`
let refEid = (col: string) => `(select eid from entity where id = ${col})`

// One capable default, with the same operator retuning seam as the fixer.
// Provider selection is execution policy, not verification identity: every
// spawned run explicitly wears the graph's verifier persona.
export let VERIFIER = {
  provider: Deno.env.get('TASKS_VERIFIER_PROVIDER') || 'codex',
  model: Deno.env.get('TASKS_VERIFIER_MODEL') || 'gpt-5.6-sol',
}

export let VERIFIER_TUNING: SystemTuning = {
  quiet: 0,
  cooldown: 5 * 60,
  cap: 2,
}

export type VerifierGates = SystemTuning & { off?: boolean }

// The alias is identity, not a fallback label. The same entity must be both
// persona and role configuration; losing either side must never silently spawn
// a generic worker with verifier authority.
export let verifierIdentity = (): string => {
  let eid = locate(db, 'verifier')
  if (!eid) throw new Error('verifier alias is missing')
  if (!readComp(db, eid, 'persona')) {
    throw new Error('verifier alias does not wear persona')
  }
  if (!readComp(db, eid, 'role')) {
    throw new Error('verifier alias does not wear role')
  }
  return eid
}

export let verifierTuning = (): VerifierGates => {
  let eid = locate(db, 'verifier')
  let row = eid
    ? db.prepare(
      `select state, quiet, cooldown, cap from role where ${OWNED}`,
    ).get(eid) as
      | {
        state: string
        quiet: number | null
        cooldown: number | null
        cap: number | null
      }
      | undefined
    : undefined
  return {
    quiet: Number(row?.quiet ?? VERIFIER_TUNING.quiet),
    cooldown: Number(row?.cooldown ?? VERIFIER_TUNING.cooldown),
    cap: Number(row?.cap ?? VERIFIER_TUNING.cap),
    off: !!row && row.state != 'running',
  }
}

type Cycle = { project: string | null; at: string }
let cycleOf = (task: string): Cycle | undefined =>
  db.prepare(
    `select ${refEid('task.project')} as project, completed.at
       from task join completed on completed.entity = task.entity
      where task.${OWNED}`,
  ).get(task) as Cycle | undefined

let muted = (project: string | null): boolean =>
  !!project &&
  !!db.prepare(`select 1 from noverify where ${OWNED}`).get(project)

// Verifier capacity is its active LEASES, not its historical Session rows.
// Every spawn below atomically takes one target claim; session settlement and
// boot reap release it. claim_session starts this count from the bounded set of
// live work rather than scanning the unbounded Session history.
let activeVerifiers = (): number =>
  Number(
    (db.prepare(
      `select count(distinct c.session) as n
         from claim c indexed by claim_session
         join verifier v on v.entity = c.session`,
    ).get() as { n: number }).n,
  )

// A terminal verifier without an independent verdict may be retried, but not
// in a tight loop. Restrict the cooldown to this completion cycle so editing
// completed.at (recompletion) immediately opens a fresh cycle.
let coolingDown = (
  task: string,
  completedAt: string,
  seconds: number,
  now = Date.now(),
): boolean =>
  !!db.prepare(
    `select 1 from session s
       join verifier v on v.entity = s.entity
       join created c on c.entity = s.entity
      where s.requested_task = ${idOf}
        and c.at > ? and c.at >= ?
      limit 1`,
  ).get(
    task,
    completedAt,
    new Date(now - Math.max(0, seconds) * 1000).toISOString(),
  )

export let verifierBlocked = (
  task: string,
  cycle: Cycle,
  t: VerifierGates = verifierTuning(),
  automatic = true,
  now = Date.now(),
): string | null => {
  let cap = Math.max(0, Number(t.cap ?? VERIFIER_TUNING.cap))
  return t.off
    ? 'stopped'
    : automatic && muted(cycle.project)
    ? 'muted'
    : Date.parse(cycle.at) > now - Math.max(0, t.quiet) * 1000
    ? 'quiet'
    : activeVerifiers() >= cap
    ? `at cap (${cap})`
    : coolingDown(task, cycle.at, t.cooldown, now)
    ? 'cooling down'
    : null
}

// `automatic=false` is the future explicit verification door. It bypasses only
// the project's noverify preference; the global role state and resource gates
// still govern every spawned worker.
export let ensureVerifier = (cast: Cast, automatic = true) =>
(
  task: string,
  _comp?: Record<string, unknown>,
  t: VerifierGates = verifierTuning(),
): string | undefined => {
  if (!verificationPending(db, task)) return
  let cycle = cycleOf(task)
  if (!cycle || verifierBlocked(task, cycle, t, automatic)) return
  let persona = verifierIdentity()
  let hint = readComp(db, persona, 'spawn') as
    | { provider?: string; model?: string; effort?: string }
    | undefined
  let provider = String(hint?.provider || VERIFIER.provider)
  let model = String(hint?.model || VERIFIER.model)
  // The task supplies project/worktree and actor; the explicit persona
  // supplies verifier instructions. Exactly these two keyed rows are enough
  // for spawnChanges — no root snapshot or graph scan.
  let { eid, changes } = spawnChanges(rowsFor(db, [task, persona]), {
    task,
    provider,
    model,
    ...(hint?.effort ? { effort: String(hint.effort) } : {}),
    persona,
  })
  // The verifier's lease is the cross-process idempotency primitive. apply()
  // takes BEGIN IMMEDIATE before checking claim's primary key, so two racers
  // cannot both commit: the winner lands session+marker+claim atomically; the
  // loser rolls its whole spawn back and leaves the ordinary conflict audit.
  commitEffects(
    (trace) =>
      apply(db, [
        ...changes,
        { eid, name: 'verifier', comp: {} },
        { eid: task, name: 'claim', comp: { session: eid } },
      ], trace),
    cast,
  )
  return eid
}

// One bounded newest-first system-role pass. Muted projects remain in
// VERIFY_PENDING for manual lanes but are excluded from automatic candidates;
// quiet/cooldown are likewise screened in SQL before the LIMIT, so a muted or
// cooling newest task cannot starve older eligible work.
export let verifierRun = (
  t: SystemTuning,
  cast: Cast,
): { reason: string; observed?: string } => {
  let cap = Math.max(0, Number(t.cap ?? VERIFIER_TUNING.cap))
  let room = cap - activeVerifiers()
  if (room <= 0) return { reason: `at cap (${cap})` }
  let now = Date.now()
  let quietBefore = new Date(now - Math.max(0, t.quiet) * 1000).toISOString()
  let retryBefore = new Date(now - Math.max(0, t.cooldown) * 1000)
    .toISOString()
  let pending = db.prepare(
    `select owner.eid as eid
       from completed indexed by completed_at
       join task on task.entity = completed.entity
       join entity owner on owner.id = task.entity
      where completed.at <= ?
        and ${VERIFY_PENDING}
        and not exists (
          select 1 from noverify where noverify.entity = task.project
        )
        and not exists (
          select 1 from session _ry
          join verifier _rv on _rv.entity = _ry.entity
          join created _rc on _rc.entity = _ry.entity
          where _ry.requested_task = task.entity
            and _rc.at > completed.at
            and _rc.at >= ?
        )
      order by completed.at desc
      limit ?`,
  ).all(quietBefore, ...verificationArgs(), retryBefore, room) as {
    eid: string
  }[]
  if (!pending.length) return { reason: 'no automatic verification due' }
  let spawned: string | undefined
  let n = 0
  for (let { eid } of pending) {
    let made = ensureVerifier(cast)(eid, undefined, { ...t, off: false })
    if (made) {
      spawned = made
      n++
    }
  }
  return {
    reason: `spawned ${n} of ${pending.length} due verifications`,
    ...(spawned ? { observed: spawned } : {}),
  }
}

export let VERIFIER_ROLE: SystemSpec = {
  alias: 'verifier',
  defaults: VERIFIER_TUNING,
  run: verifierRun,
}
