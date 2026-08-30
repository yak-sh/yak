// The transport-neutral verifier policy (D-25036): one SQL predicate defines
// completed work awaiting independent acceptance, and one keyed lookup answers
// whether its current completion cycle already has a live verifier. This file
// imports no server singleton or effect machinery, so query lanes, explicit
// commands, and the role engine can share it without pulling in a runtime.
import type { DatabaseSync } from './sqlite.ts'
import { sessionActive } from './types.ts'

let activeSql = `s.status is null or s.status in (${
  sessionActive.map(() => '?').join(', ')
})`

// One qualification and ordering sentence serves both the pending predicate
// and review settlement. The latter must never reinterpret which review wins:
// a delayed effect re-reads this exact query and acts only when its own review
// is still the latest qualifying verdict for the current completion cycle.
let reviewTables = `comment _vm
  join review _vr on _vr.entity = _vm.entity
  join entity _ve on _ve.id = _vr.entity
  join doc_value _vd on _vd.entity = _vm.entity
  join created _va on _va.entity = _vm.entity
  join session _vs on _vs.entity = _va.via`
let reviewWhere = (target: string, at: string, via: string) => `
  _vm.target = ${target}
  and _vr.verdict in ('approved', 'rejected', 'changes_requested')
  and text_present(_vd.body)
  and _va.at > ${at}
  and _va.via != ${via}`
let reviewOrder = `order by _va.at desc, _ve.eid desc limit 1`

// Assumes the outer task table is named `task`. Review evidence is reached
// through comment.target (indexed), and verifier attempts through
// session.requested_task (indexed). The current completed row is a keyed
// component lookup. No graph-wide entity or component enumeration participates.
//
// A newly minted Session has no lifecycle status until its launch effect runs;
// null therefore counts as active. Only a terminal status permits a retry.
export let VERIFY_PENDING = `
  exists (select 1 from accept where accept.entity = task.entity)
  and not exists (select 1 from cancelled where cancelled.entity = task.entity)
  and exists (
    select 1 from completed _vc
    join session _vb on _vb.entity = _vc.via
    where _vc.entity = task.entity
      and coalesce((
        select _vr.verdict
          from ${reviewTables}
         where ${reviewWhere('task.entity', '_vc.at', '_vc.via')}
         ${reviewOrder}
      ), '') <> 'approved'
      and not exists (
        select 1 from session s
        join verifier v on v.entity = s.entity
        join created _vz on _vz.entity = s.entity
        where s.requested_task = task.entity
          and _vz.at > _vc.at
          and (${activeSql})
      )
  )`

let activeArgs = sessionActive

export type VerificationReview = {
  eid: string
  verdict: 'approved' | 'rejected' | 'changes_requested'
  via: string
  completedAt: string
}

// The current cycle's authoritative outcome. This is keyed by task eid and
// shares every qualifier and tie-break with VERIFY_PENDING above; callers may
// compare the returned eid with the event they are handling to reject stale or
// out-of-order effect delivery.
export let latestVerificationReview = (
  db: DatabaseSync,
  eid: string,
): VerificationReview | undefined =>
  db.prepare(
    `select _ve.eid, _vr.verdict,
            (select eid from entity where id = _va.via) as via,
            _vc.at as completedAt
       from ${reviewTables}
       join completed _vc on _vc.entity = _vm.target
       join task on task.entity = _vm.target
      where task.entity = (select id from entity where eid = ?)
        and ${reviewWhere('task.entity', '_vc.at', '_vc.via')}
      ${reviewOrder}`,
  ).get(eid) as VerificationReview | undefined

// Keyed current-cycle lookup used by every imperative spawn door. The caller
// supplies an eid; the task/completed owner primary keys and
// session_requested_task index bound the read to that one task.
export let hasVerifier = (db: DatabaseSync, task: string): boolean =>
  !!db.prepare(
    `select 1
       from task
       join completed _vc on _vc.entity = task.entity
      where task.entity = (select id from entity where eid = ?)
        and exists (
          select 1 from session s
          join verifier v on v.entity = s.entity
          join created _vz on _vz.entity = s.entity
          where s.requested_task = task.entity
            and _vz.at > _vc.at
            and (${activeSql})
        )
      limit 1`,
  ).get(task, ...activeArgs)

// The exact keyed form of VERIFY_PENDING. Imperative callers re-read it before
// every spawn; derived lanes use VERIFY_PENDING directly in their own bounded
// selection instead of reimplementing the policy in TypeScript.
export let verificationPending = (
  db: DatabaseSync,
  eid: string,
): boolean =>
  !!db.prepare(
    `select 1 from task
      where task.entity = (select id from entity where eid = ?)
        and ${VERIFY_PENDING}
      limit 1`,
  ).get(eid, ...activeArgs)

// VERIFY_PENDING contains the active-state placeholders once. Keep the binding
// beside the predicate so downstream SQL can compose it without knowing which
// lifecycle values count as live.
export let verificationArgs = () => [...activeArgs]
