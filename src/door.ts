// The door: is anyone LISTENING to a session, and is its provider process
// PRESENT? Claude's channel makes both true; interactive Codex has a process
// and transcript but no message channel. Keeping the questions separate lets
// sessions.ts follow both logs without claiming Codex heard a knock.
// SERVER-ONLY (imports db).
import { db } from './db.ts'
import { commOf } from './proc.ts'
import { type Seat, served } from './served.ts'
import { sessionActive } from './types.ts'

type Door = { eid: string; pid: number | null; status: string | null }

// The newest session wearing a provider process. An older row on a live pid is
// a ghost: Claude's channel moved on, and a transcript follower must too.
let seat = (pid: number) =>
  served(
    db.prepare(
      `select s.eid, e.num, s.pid from session s join entity e on e.eid = s.eid
       where s.pid = ?`,
    ).all(pid) as Seat[],
    pid,
  )?.eid

let state = (eid: string) =>
  db.prepare(
    'select eid, pid, status from session where eid = ?',
  ).get(eid) as Door | undefined

let terminal = (s?: Door) => {
  if (!s?.pid || seat(s.pid) != s.eid) return ''
  let comm = commOf(s.pid)
  return comm == 'claude' || comm == 'codex' ? comm : ''
}

// A managed run is present through its lifecycle; an external one through the
// provider pid SessionStart stamped. Pid reuse is guarded by comm + newest seat.
export let present = (eid: string) => {
  let s = state(eid)
  return !!s &&
    (sessionActive.includes(String(s.status)) || !!terminal(s))
}

// A process is a message door only when it has an ear. Managed sessions are
// tailed by us; external Claude has a channel; interactive Codex has neither.
export let listening = (eid: string) => {
  let s = state(eid)
  return !!s &&
    (sessionActive.includes(String(s.status)) || terminal(s) == 'claude')
}
