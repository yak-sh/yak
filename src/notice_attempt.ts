// The server-owned ledger for content-free session wake attempts. An attempt
// is an ordinary notice deliverable: its eid is the opaque retry token,
// created.at is submission, and delivered.at or error settles it. This module
// also carries the one-release read fallback for the retired Session triple.
import { apply } from './db.ts'
import { delivered, errored } from './deliver.ts'
import { db } from './live_db.ts'
import type { Change } from './types.ts'

let RETRY_MS = 5_000
type Cast = (changes: Change[]) => void

export type NoticeAttempt =
  | {
    state: 'pending'
    eid: string
    submitted: string
  }
  | {
    state: 'accepted'
    eid: string
    submitted: string
    accepted: string
  }
  | {
    state: 'failed'
    eid: string
    submitted: string
    failed: string
  }
  | {
    state: 'legacy-pending'
    submitted: string
  }
  | {
    state: 'legacy-accepted'
    submitted: string
    accepted: string
  }

export type LegacyNotice = {
  notice_at: string | null
  notice_accepted_at: string | null
  notice_token: string | null
}

// The latest attempt is an indexed target lookup. History remains available,
// but retry and acceptance only care about the newest token, exactly as the
// overwritten Session triple did.
export let noticeOf = (
  session: string,
  legacy?: LegacyNotice,
): NoticeAttempt | undefined => {
  let row = db.prepare(`
    select o.eid, c.at as submitted, d.at as accepted, x.at as failed
    from notice n
    join entity o on o.id = n.entity
    join created c on c.entity = n.entity
    join deliver v on v.entity = n.entity
    left join delivered d on d.entity = n.entity
    left join error x on x.entity = n.entity
    where n.target = (select id from entity where eid = ?)
      and v."to" = n.target and n.event = 'wake'
    order by c.at desc, n.entity desc limit 1
  `).get(session) as {
    eid: string
    submitted: string
    accepted: string | null
    failed: string | null
  } | undefined
  if (row) {
    if (row.accepted) {
      return {
        state: 'accepted',
        eid: row.eid,
        submitted: row.submitted,
        accepted: row.accepted,
      }
    }
    if (row.failed) {
      return {
        state: 'failed',
        eid: row.eid,
        submitted: row.submitted,
        failed: row.failed,
      }
    }
    return { state: 'pending', eid: row.eid, submitted: row.submitted }
  }
  if (!legacy?.notice_at) return
  return legacy.notice_accepted_at
    ? {
      state: 'legacy-accepted',
      submitted: legacy.notice_at,
      accepted: legacy.notice_accepted_at,
    }
    : { state: 'legacy-pending', submitted: legacy.notice_at }
}

export let noticeDue = (
  attempt: NoticeAttempt | undefined,
  now: number,
  pendingAt: string,
) => {
  let sent = Date.parse(attempt?.submitted ?? '')
  if (!Number.isFinite(sent)) return true
  let pending = Date.parse(pendingAt)
  if (Number.isFinite(pending) && pending > sent) return true
  if (attempt?.state == 'failed') return true
  if (
    attempt?.state == 'accepted' || attempt?.state == 'legacy-accepted'
  ) return Date.parse(attempt.accepted) < sent
  return now - sent >= RETRY_MS
}

export let beginNotice = (session: string, token: string, cast: Cast) => {
  let out = apply(db, [{
    eid: token,
    name: 'notice',
    comp: { target: session, event: 'wake' },
  }, {
    eid: token,
    name: 'deliver',
    comp: { to: session },
  }])
  cast(out)
}

export let acceptNotice = (token: string, via: string, cast: Cast) =>
  delivered(token, via, cast)

export let failNotice = (token: string, message: string, cast: Cast) =>
  errored(token, message, cast)
