// The delivery lifecycle, as two shared components (D-14945 phase 1):
// `delivered {at, via}` — an entity reached its destination, and how — and
// `error {at, message}` — an attempt failed, and why. A deliverable is
// tri-state, exactly like `notified`/`opened`/`archived`: delivered =
// success, error = failure, neither = pending. They REPLACE the per-type
// receipt columns each deliverable used to bake onto its own component
// (knock's acted_at/delivery/error, wake's acted_at/error, mail's
// acted_at/error, stop_request's acted_at) — one aspect, one component,
// worn by any deliverable that settles.
//
// Server-owned and effect-written: like the receipts they replace, an
// outcome never crosses apply() (the wire can write neither), so each
// stamp writes its own row and BROADCASTS it, or a client cache would hold
// a deliverable that never settles. `via` is descriptive text (`cast S-9`,
// `spawned S-9`, `local`, a mail's Message-ID), not an eid — how it went
// out, said the way the ladder said it. SERVER-ONLY (imports db).
//
// It also owns `exception {at, message, stack?}` (D-17077) — `error`'s sibling
// by aspect: `error` is a known/expected failure state, `exception` is a BUG
// (something unexpected broke), and it is the self-healing trigger. excepted()
// stamps it and fires the heal effect on the spot.
import { db, record } from './db.ts'
import { record as telemetry } from './telemetry.ts'
import { dispatch, trace } from './effects.ts'
import { type Change } from './types.ts'

type Cast = (changes: Change[]) => void
let now = () => new Date().toISOString()
let publish = (changes: Change[], cast: Cast) => {
  if (!changes.length) return
  record(db, changes)
  cast(changes)
}

// Settle a deliverable as DELIVERED. Insert-or-replace on the eid: an
// effect records one outcome, and a boot-sweep re-drive overwrites the same
// row rather than piling a second up.
export let delivered = (eid: string, via: string, cast: Cast) => {
  let at = now()
  db.prepare(
    `insert into delivered (eid, at, via) values (?, ?, ?)
     on conflict(eid) do update set at = excluded.at, via = excluded.via`,
  ).run(eid, at, via || null)
  cast([{ eid, name: 'delivered', comp: { eid, at, via: via || null } }])
}

// Stamp the shared failure facet. It is broader than delivery: roles,
// sessions, and freezes use this same writer, which is what makes `.error`
// the fleet health query. An unchanged failure stays put so a reconcile tick
// cannot turn one incident into an endless stream of new timestamps.
//
// `error` is a KNOWN/expected failure state (D-17077) — a handled condition
// worth surfacing but not a bug — so it does NOT trigger self-healing. The
// break facet is `exception` (below); a subsystem that hit something
// UNEXPECTED calls excepted(), and the T-17081 audit reclassifies each
// current error writer into one or the other.
export let errored = (
  eid: string,
  message: string,
  cast: Cast,
  at = now(),
) => {
  let change = errorChange(eid, message, at)
  if (change) publish([change], cast)
}

// The data half is exported for writers that atomically move their own
// lifecycle beside the shared facet. They own the surrounding transaction,
// journal batch, and cast batch; this owns the error table's one shape.
export let errorChange = (
  eid: string,
  message: string,
  at = now(),
): Change | undefined => {
  let prior = db.prepare('select at, message from error where eid = ?').get(
    eid,
  ) as
    | { at: string | null; message: string | null }
    | undefined
  if (prior?.message == message && prior.at) return
  db.prepare(
    `insert into error (eid, at, message) values (?, ?, ?)
     on conflict(eid) do update set at = excluded.at, message = excluded.message`,
  ).run(eid, at, message)
  return { eid, name: 'error', comp: { eid, at, message } }
}

// The BREAK facet (D-17077): something the code/process hit that it did not
// expect — a thrown exception, exit 127, a died process, a violated
// invariant. This is the self-healing TRIGGER, `error`'s sibling by aspect
// (M-14942): `error` is a known state, `exception` is a bug. `stack` is
// optional (a JS throw carries one; a died process may not) and rides ON the
// facet — it describes this same fault, the machine "where" to message's "why".
// Server-owned and effect-written like error; a re-stamp with the same
// message+stack stays put so a reconcile tick cannot storm the timestamp.
export let exceptionChange = (
  eid: string,
  message: string,
  stack: string | null = null,
  at = now(),
): Change | undefined => {
  let prior = db.prepare(
    'select at, message, stack from exception where eid = ?',
  )
    .get(eid) as
      | { at: string | null; message: string | null; stack: string | null }
      | undefined
  if (prior?.message == message && prior.stack == stack && prior.at) return
  db.prepare(
    `insert into exception (eid, at, message, stack) values (?, ?, ?, ?)
     on conflict(eid) do update set
       at = excluded.at, message = excluded.message, stack = excluded.stack`,
  ).run(eid, at, message, stack)
  return { eid, name: 'exception', comp: { eid, at, message, stack } }
}

// Stamp the break facet AND fire its created() effects — the self-healing
// ticket filer (heal.ts) chief among them. This is the ONE live seam: a
// break-site that hit something unexpected calls excepted(), and the effect
// files a deduped bug ticket at once. Dispatch isolates a throwing handler
// into telemetry, so a broken filer can never break this stamp or the wire
// (the effects.ts contract). Breaks written straight to the table by a
// narrower door are caught by the boot sweep instead.
export let excepted = (
  eid: string,
  message: string,
  stack: string | null = null,
  cast: Cast,
  at = now(),
) => {
  let change = exceptionChange(eid, message, stack, at)
  if (!change) return
  publish([change], cast)
  let t = trace()
  t.created.add(`exception ${change.eid}`)
  dispatch([change], t, (comp, e) =>
    telemetry(db, {
      source: 'srv',
      name: `effect:${comp}`,
      ok: false,
      error: String(e),
    }))
}

// Absence is healthy. Delete the facet through the same journal + cast door
// as a failure stamp so catch-up clients and live clients shed it together.
export let healthy = (eid: string, cast: Cast) => {
  let change = healthChange(eid)
  if (change) publish([change], cast)
}

export let healthChange = (eid: string): Change | undefined => {
  if (!db.prepare('select 1 from error where eid = ?').get(eid)) return
  db.prepare('delete from error where eid = ?').run(eid)
  return { eid, name: 'error', comp: null }
}

// Has this deliverable already settled? Either outcome present means the
// effect ran — the crash-gap key the old `acted_at is null` guarded, now
// read as component presence.
export let settled = (eid: string): boolean =>
  !!db.prepare(
    `select 1 from delivered where eid = ?
     union all select 1 from error where eid = ?`,
  ).get(eid, eid)

// WHERE this deliverable goes — the recipient off the shared `deliver {to}`
// facet (D-14945). The effects read it here rather than off their own
// component, since the recipient is one aspect factored out of all of them.
// '' when none is on file: a deliverable with no recipient is inert, and the
// resolver stamps that as its error rather than crashing.
export let toOf = (eid: string): string =>
  String(
    (db.prepare('select "to" from deliver where eid = ?').get(eid) as
      | { to?: string }
      | undefined)?.to ?? '',
  )

// The pending predicate as a WHERE fragment over a deliverable's OWN table:
// no outcome component yet. The boot sweeps (server.ts) and the queue
// readers (wake.ts pending) share this one shape, so "unacted" means the
// same thing everywhere it is asked.
export let PENDING = (table: string) =>
  `not exists (select 1 from delivered where delivered.eid = ${table}.eid)
   and not exists (select 1 from error where error.eid = ${table}.eid)`
