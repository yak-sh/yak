// The wake: an attention ask held until its hour. One timer for the whole
// server,
// armed at the earliest pending row and re-armed as each fires — never a
// poller per wake, and never a process's own memory of when to come back.
// That is the point: a wake is a ROW, so a restart (of the agent, of
// tasksd, of the box) delays it at worst. Boot hands every unacted row
// back through created() (the effects sweep), which is how a wake whose
// hour passed while the server was down fires on startup instead of
// vanishing. Firing walks the shared delivery ladder and settles this wake;
// no knock artifact stands between the ask and its outcome. SERVER-ONLY.
import { apply, db } from './db.ts'
import { deliver, errored, PENDING, settle } from './deliver.ts'
import { type Change } from './types.ts'
import { instant } from './time.ts'

type Cast = (changes: Change[]) => void
type Row = {
  eid: string
  at: string
  to: string
  target_eid: string | null
  minted: string | null
}

let iso = (t: number) => new Date(t).toISOString()

// setTimeout's ceiling is 32 bits (~24 days) and a suspended box lets a
// long sleep drift; an hour's re-arm costs one query and makes both
// harmless. The timer still names the earliest wake — it just wakes up
// to check on anything further out.
let HOUR = 3_600_000
let timer: ReturnType<typeof setTimeout> | undefined

// Everything still owed, earliest first — carrying the moment it was
// minted, because that is the clock a phrase resolves against. Unacted =
// neither delivered nor error present (D-14945).
let pending = () =>
  db.prepare(
    `select wake.eid, wake.at, deliver."to" as "to", wake.target_eid,
       c.at as minted
     from wake join deliver on deliver.eid = wake.eid
     left join created c on c.eid = wake.eid
     where ${PENDING('wake')} order by wake.at`,
  ).all() as Row[]

// No target means the wake itself is the subject. Its doc body is the asker's
// reason; a named subject contributes its own title inside the ladder.
let fire = (r: Row, cast: Cast) => {
  let doc = db.prepare(
    `select d.body, c."by" from doc d
     left join created c on c.eid = d.eid where d.eid = ?`,
  ).get(r.eid) as { body?: string; by?: string | null } | undefined
  settle(
    r.eid,
    deliver(
      r.to,
      r.target_eid ?? r.eid,
      { body: String(doc?.body ?? ''), by: doc?.by },
      cast,
    ),
    cast,
  )
}

// Fire what is owed, then wait for the next. Idempotent by design — the
// created() hook, the boot sweep, and the timer itself all just call it.
export let arm = (cast: Cast) => {
  clearTimeout(timer)
  timer = undefined
  let next: number | undefined
  for (let r of pending()) {
    let at = instant(r.at, Date.parse(r.minted ?? '') || Date.now())
    if (at == null) {
      errored(r.eid, `unreadable at: ${r.at}`, cast)
      continue
    }
    // Absolute at mint: the verbs resolve the phrase before they send,
    // but a wake written straight to the wire may still hold one — pin
    // it to the moment it was minted, so every later reader (a filter, a
    // list, this timer) compares timestamps and gets the same answer.
    if (r.at != iso(at)) {
      cast(apply(db, [{ eid: r.eid, name: 'wake', comp: { at: iso(at) } }]))
    }
    if (at > Date.now()) {
      next = Math.min(next ?? at, at)
      continue
    }
    try {
      fire(r, cast)
    } catch (e) {
      // A wake that can't deliver (its door tombstoned mid-flight) says so
      // and is done — an unacted row would retry on every arm forever.
      errored(r.eid, String(e).slice(0, 500), cast)
    }
  }
  if (next != null) {
    timer = setTimeout(
      () => arm(cast),
      Math.min(Math.max(next - Date.now(), 0), HOUR),
    )
  }
}

// The registration's handler: any wake minted (or moved) re-reads the
// queue — one timer, whoever asked.
export let waking = (cast: Cast) => () => arm(cast)
