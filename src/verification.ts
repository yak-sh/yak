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
          from comment _vm
          join review _vr on _vr.entity = _vm.entity
          join entity _ve on _ve.id = _vr.entity
          join doc_value _vd on _vd.entity = _vm.entity
          join created _va on _va.entity = _vm.entity
          join session _vs on _vs.entity = _va.via
         where _vm.target = task.entity
           and _vr.verdict in ('approved', 'rejected', 'changes_requested')
           and trim(
             coalesce(_vd.body, ''),
             char(9) || char(10) || char(11) || char(12) || char(13) || ' '
           ) <> ''
           and _va.at > _vc.at
           and _va.via != _vc.via
         order by _va.at desc, _ve.eid desc
         limit 1
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
