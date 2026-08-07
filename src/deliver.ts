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
import { db, record } from './db.ts'
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
