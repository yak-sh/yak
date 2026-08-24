// Dep-completion knock (D-21448 Piece 2 — the core wake). When a task ENDS
// (done/cancelled), the tasks that `requires` it may have just lost their last
// blocker. For each such dependent that is now fully UNGATED and has a CLAIMANT
// session, mint a knock at that session. The knock ladder (knock.ts) does the
// rest with zero new machinery: rung 1 casts to a live session, rung 1b resumes
// a PARKED managed run (Piece 1 retained its claim) via the comment door →
// resume() continues the parent with a "you're unblocked" backlog. The last
// blocker's knock wakes the parent to finish its own task.
//
// The wait registration is the EDGE, not a subscription facet: a claim on a task
// with an open `requires` blocker IS "waiting on those blockers", so this effect
// just reads the graph a completion already changed. Targets the SESSION (not
// the task) because rung 1b's direct-session door resumes the managed run
// regardless of the current claim. At-most-once like every effect; a knock is
// at-least-once deliverable, so a lost fire is recovered by nothing more than
// the next completion — no sweep, no reconcile.
//
// "Ungated" is sessions.ts `gatedTask` verbatim — the same requires reading
// dispatch's ready() and Piece 1's park retention use, imported rather than
// re-derived so the three never drift. SERVER-ONLY (imports db).
import { apply, db, depsOf } from './db.ts'
import { dispatch, trace } from './effects.ts'
import { type Change, uuid } from './types.ts'
import { gatedTask } from './sessions.ts'

type Cast = (changes: Change[]) => void

// The eid→id storage seam (D-18866): claim keys by the task's owner int id and
// stores its session as an int id; this module speaks EIDs.
let refEid = (col: string) => `(select eid from entity where id = ${col})`

// The statuses that END a task — the same set closing.ts closes on. Closing is
// an act, so re-closing an already-done task re-knocks; harmless (a second
// resume comment the parent simply reads), and not worth a guard.
let terminal = new Set(['done', 'cancelled'])

// The session currently claiming this task, or null. A claim row keys by the
// task entity and carries its claimer in `session`.
let claimant = (taskEid: string): string | null =>
  (db.prepare(
    `select ${refEid('session')} as session from claim
       where entity = (select id from entity where eid = ?)`,
  ).get(taskEid) as { session: string | null } | undefined)?.session ?? null

export let unblocking =
  (cast: Cast) => (eid: string, comp: Record<string, unknown>) => {
    if (!terminal.has(String(comp.status ?? ''))) return
    // Tasks that `requires` the one that just ended — the reverse edge.
    let dependents = depsOf(db, [eid])
      .filter((d) => d.type == 'requires' && d.child == eid)
      .map((d) => d.parent)
    if (!dependents.length) return
    let out: Change[] = []
    for (let t of dependents) {
      if (gatedTask(t)) continue // another blocker still holds it
      let session = claimant(t)
      if (!session) continue // nobody parked-waiting on it
      let k = uuid()
      out.push(
        { eid: k, name: 'knock', comp: { target: t } },
        { eid: k, name: 'deliver', comp: { to: session } },
      )
    }
    if (!out.length) return
    let t = trace()
    let done = apply(db, out, t, null)
    cast(done)
    dispatch(done, t, (n, e) => console.warn(`unblock knock ${n} —`, e))
  }
