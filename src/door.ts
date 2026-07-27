// The delivery door. Presence is process/lifecycle truth; delivery is a
// separate transport decision. A reachable door can surface graph content
// now. A queued door has a live session but must leave content pending for an
// adapter (Codex's tmux notice is intentionally not content delivery).
//
// `notified` remains the per-item fact that content was surfaced. Neither a
// queued route nor a successful wake-up notice may mint that stamp.
// SERVER-ONLY (imports db).
import { db } from './db.ts'
import { commOf } from './proc.ts'
import { type Seat, served } from './served.ts'
import { sessionActive } from './types.ts'

type Row = {
  eid: string
  pid: number | null
  pane: string | null
  status: string | null
}
export type Delivery = {
  state: 'absent' | 'queued' | 'reachable'
  transport: 'managed' | 'channel' | 'tmux' | null
}

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
    'select eid, pid, pane, status from session where eid = ?',
  ).get(eid) as Row | undefined

let terminal = (s?: Row) => {
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

// One provider-neutral routing decision. Managed sessions have the daemon bus;
// external Claude has a content channel. Native Codex names a tmux route when
// it has a pane, but its graph content remains queued for task_context.
export let delivery = (eid: string): Delivery => {
  let s = state(eid)
  if (!s) return { state: 'absent', transport: null }
  if (sessionActive.includes(String(s.status))) {
    return { state: 'reachable', transport: 'managed' }
  }
  let provider = terminal(s)
  if (provider == 'claude') {
    return { state: 'reachable', transport: 'channel' }
  }
  if (provider == 'codex') {
    return {
      state: 'queued',
      transport: s.pane ? 'tmux' : null,
    }
  }
  return { state: 'absent', transport: null }
}

export let reachable = (eid: string) => delivery(eid).state == 'reachable'
