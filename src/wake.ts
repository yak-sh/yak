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
import { apply, db, human } from './db.ts'
import { delivered, errored, PENDING } from './deliver.ts'
import { dispatch, trace } from './effects.ts'
import { type Change, uuid } from './types.ts'
import { instant } from './time.ts'

type Cast = (changes: Change[]) => void
type Row = {
  eid: string
  at: string
  to: string
  target: string | null
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
    `select wake.eid, wake.at, deliver."to" as "to", wake.target,
       c.at as minted
     from wake join deliver on deliver.eid = wake.eid
     left join created c on c.eid = wake.eid
     where ${PENDING('wake')} order by wake.at`,
  ).all() as Row[]

// The knock this wake was always going to be. No target means the wake
// itself is the subject.
let fire = (r: Row, cast: Cast) => {
  let t = trace()
  let ke = uuid()
  let out = apply(db, [
    {
      eid: ke,
      name: 'knock',
      comp: { target: r.target ?? r.eid },
    },
    { eid: ke, name: 'deliver', comp: { to: r.to } },
  ], t)
  cast(out)
  dispatch(out, t, (c, e) => console.warn(`wake ${c} —`, e))
  // Settled DELIVERED after the mint: the wake did its one job, minting the
  // knock that owns the ladder. `via` names it. A crash in the gap re-knocks
  // at boot — a duplicate nudge is cheaper than the missed one this whole
  // entity exists to prevent.
  delivered(r.eid, `knock ${human(db, ke)}`, cast)
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
      // A wake that can't knock (its door tombstoned mid-flight) says so
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
