// The door: is anyone LISTENING to a session right now? Two places ask —
// the knock ladder's first rung (knock.ts) and comment-resume's gate
// (sessions.ts) — and both used to ask it as `origin = 'managed'`, which
// shut out every operator: an operator runs plain `claude` and reifies as
// 'external', and knocking on an operator's door is the whole point of
// knocks (T-7279). Origin says who STARTED a session; it never says
// whether anybody is home. SERVER-ONLY (imports db).
import { db } from './db.ts'
import { commOf } from './proc.ts'
import { sessionActive } from './types.ts'

type Door = { eid: string; pid: number | null; status: string | null }

// The session a claude process's channel plugin serves: the NEWEST row
// wearing that pid. A pid names a PROCESS, not a session — a /clear
// reifies a new entity under the same one, and several rows can end up
// sharing a pid — and the plugin only ever rotates FORWARD, to the higher
// num (channels/tasks/server.ts). So an older row on a live pid is a
// ghost: nothing sent to it renders anywhere, and calling it awake would
// silence the fallback that would have reached someone.
let served = (pid: number) =>
  (db.prepare(
    `select s.eid from session s join entity e on e.eid = s.eid
     where s.pid = ? order by e.num desc limit 1`,
  ).get(pid) as { eid: string } | undefined)?.eid

// Someone is home when either ear is open: a session we spawned is heard
// through its log tail while it's still going, and a session that got the
// SessionStart hook is heard through its channel — which needs the pid to
// still BE a claude (pids get reused, so comm is checked, not existence)
// and this row to still be the one that process serves. A session with
// neither — no pid, no active run — has no door.
export let listening = (eid: string) => {
  let s = db.prepare(
    'select eid, pid, status from session where eid = ?',
  ).get(eid) as Door | undefined
  if (!s) return false
  return sessionActive.includes(String(s.status)) ||
    (!!s.pid && commOf(s.pid) == 'claude' && served(s.pid) == s.eid)
}
