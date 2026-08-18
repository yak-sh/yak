// Closing a task closes its correspondence. An inbox answers one
// question — is anything waiting for me? — and a letter about a task
// that is already done is not waiting. Left alone the pile grows until
// the answer is unreadable (277 unread here, 252 of them about closed
// tasks), so the close itself archives what was addressed about the
// task at that moment.
//
// Why an EFFECT and not a derived predicate: deriving it (skip inbox
// items whose target is closed) would store nothing and never drift,
// the way a board stores no membership — but a letter that arrived
// AFTER the close would be born invisible, and a letter questioning a
// closure is exactly the one that must be seen. Closing is an act at a
// moment, not a membership fact. So it archives what exists when it
// fires and never touches what comes later.
//
// Housekeeping, so it is allowed to miss: a close while the server is
// down simply leaves the inbox noisier. No sweep, no reconcile.
// SERVER-ONLY (imports db).
import { apply, db } from './db.ts'
import { dispatch, trace } from './effects.ts'
import { type Change } from './types.ts'

type Cast = (changes: Change[]) => void

// The eid→id storage seam (D-18866): component tables key by the owner int id
// and store refs as int ids; this module speaks EIDs. OWNED matches a row by
// owner eid, refEid projects a stored ref id back to its eid on read.
let OWNED = `entity = (select id from entity where eid = ?)`
let refEid = (col: string) => `(select eid from entity where id = ${col})`

// The statuses that END a task. Closing is an ACT, not a state, so
// closing an already-closed task closes its correspondence again —
// sweeping up whatever arrived since. That is the honest reading of
// "I am closing this", and nothing is lost: `task inbox --all` is
// where the archived went.
let terminal = new Set(['done', 'cancelled'])

// Everything addressed ABOUT this task and not yet hidden. Read state
// is irrelevant — the conversation is settled, not merely seen — so
// this is `archived`, the one stamp that hides, and nothing else.
let waiting = (task: string): string[] =>
  (db.prepare(
    `select co.eid as eid from comment c
        join entity co on co.id = c.entity
       where c.target = (select id from entity where eid = ?1)
         and c.entity not in (select entity from archived)
     union
     select mo.eid as eid from mail m
        join entity mo on mo.id = m.entity
       where m.target = (select id from entity where eid = ?1)
         and m.entity not in (select entity from archived)`,
  ).all(task) as { eid: string }[]).map((r) => r.eid)

export let closingTask =
  (cast: Cast) => (eid: string, comp: Record<string, unknown>) => {
    if (!terminal.has(String(comp.status ?? ''))) return
    let items = waiting(eid)
    if (!items.length) return
    // Attributed to whoever closed it: they archived this mail by
    // closing the task, which is the truth the stamp should carry.
    let by = (db.prepare(
      `select ${refEid('"by"')} as "by" from updated where ${OWNED}`,
    )
      .get(eid) as { by: string | null } | undefined)?.by ?? null
    let t = trace()
    let out = apply(
      db,
      items.map((e) => ({ eid: e, name: 'archived', comp: {} })),
      t,
      by,
    )
    cast(out)
    dispatch(out, t, (n, e) => console.warn(`closing archive ${n} —`, e))
  }
