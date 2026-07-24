// The wake: a knock held until its hour. One timer for the whole server,
// armed at the earliest pending row and re-armed as each fires — never a
// poller per wake, and never a process's own memory of when to come back.
// That is the point: a wake is a ROW, so a restart (of the agent, of
// tasksd, of the box) delays it at worst. Boot hands every unacted row
// back through created() (the effects sweep), which is how a wake whose
// hour passed while the server was down fires on startup instead of
// vanishing. Firing MINTS A KNOCK and stops there — knock.ts owns the
// ladder that finds a door, and a wake that re-implemented delivery
// would be a second one to keep true. SERVER-ONLY (imports db).
import { apply, db } from './db.ts'
import { dispatch, trace } from './effects.ts'
import { type Change, uuid } from './types.ts'
import { instant } from './query.ts'

type Cast = (changes: Change[]) => void
type Row = {
  eid: string
  at: string
  to_eid: string
  target_eid: string | null
  minted: string | null
}

let now = () => new Date().toISOString()
let iso = (t: number) => new Date(t).toISOString()

// setTimeout's ceiling is 32 bits (~24 days) and a suspended box lets a
// long sleep drift; an hour's re-arm costs one query and makes both
// harmless. The timer still names the earliest wake — it just wakes up
// to check on anything further out.
let HOUR = 3_600_000
let timer: ReturnType<typeof setTimeout> | undefined

// The one writer for the receipt — outcomes never cross apply(), so the
// stamp broadcasts its own full row (knock.ts's rule).
let stamp = (
  eid: string,
  patch: Record<string, string | null>,
  cast: Cast,
) => {
  let cols = Object.keys(patch)
  db.prepare(
    `update wake set ${cols.map((c) => `"${c}" = ?`).join(', ')}
     where eid = ?`,
  ).run(...cols.map((c) => patch[c]), eid)
  let row = db.prepare('select * from wake where eid = ?').get(eid)
  if (row) cast([{ eid, name: 'wake', comp: row as Record<string, unknown> }])
}

// Everything still owed, earliest first — carrying the moment it was
// minted, because that is the clock a phrase resolves against.
let pending = () =>
  db.prepare(
    `select w.eid, w.at, w.to_eid, w.target_eid, c.at as minted
     from wake w left join created c on c.eid = w.eid
     where w.acted_at is null order by w.at`,
  ).all() as Row[]

// The knock this wake was always going to be. No target means the wake
// itself is the subject — its doc carries whatever the asker said.
let fire = (r: Row, cast: Cast) => {
  let t = trace()
  let out = apply(db, [{
    eid: uuid(),
    name: 'knock',
    comp: { target_eid: r.target_eid ?? r.eid, to_eid: r.to_eid },
  }], t)
  cast(out)
  dispatch(out, t, (c, e) => console.warn(`wake ${c} —`, e))
  // Stamped AFTER the mint: a crash in the gap re-knocks at boot, and a
  // duplicate nudge is cheaper than the missed one this whole entity
  // exists to prevent.
  stamp(r.eid, { acted_at: now() }, cast)
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
      stamp(r.eid, { acted_at: now(), error: `unreadable at: ${r.at}` }, cast)
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
      // A wake that can't knock (its door tombstoned mid-flight) says so
      // and is done — an unacted row would retry on every arm forever.
      stamp(r.eid, { acted_at: now(), error: String(e).slice(0, 500) }, cast)
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
