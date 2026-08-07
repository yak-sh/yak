// Delivery's shared lifecycle and attention ladder. Every deliverable settles
// into one of two shared components (D-14945):
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
// out, said the way the ladder said it.
//
// A knock and a fired wake share the ladder below: cast to an awake operator,
// resume a managed session, spawn a project operator, or mail an address. The
// ladder returns an outcome; its caller stamps the entity that asked, so a wake
// stays a wake instead of minting a knock as an implementation artifact.
// SERVER-ONLY (imports db).
import { apply, db, human, record, snapshot } from './db.ts'
import { reachable } from './door.ts'
import { dispatch, trace } from './effects.ts'
import { type Change, uuid } from './types.ts'
import { isOperator, rows, spawnChanges } from './client.ts'
import { adapters } from './adapters.ts'

type Cast = (changes: Change[]) => void
export type Outcome = { via: string } | { error: string }
export type Words = { body: string; by?: string | null; lead?: string }
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
  publish(
    [{ eid, name: 'delivered', comp: { eid, at, via: via || null } }],
    cast,
  )
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

// Who is awake for an identity: the session itself, or — for an actor — an
// operator session running that actor's loop. Only the operator loop hears an
// actor-addressed item, so a managed sibling wearing the actor must not take
// the cast. Newest first follows conversation rotation.
let awake = (to: string): { eid: string; num: number } | undefined =>
  (db.prepare(
    `select s.eid, e.num, s.operator, s.requested_task_eid, s.origin,
            s.role_eid
     from session s join entity e on e.eid = s.eid
     where s.eid = ? or s.actor_eid = ?
     order by e.num desc`,
  ).all(to, to) as ({ eid: string; num: number } & Record<string, unknown>)[])
    .filter((s) => s.eid == to || isOperator(s))
    .find((s) => reachable(s.eid))

let titleOf = (eid: string) =>
  String(
    (db.prepare('select title from doc where eid = ?').get(eid) as
      | { title?: string }
      | undefined)?.title ?? '',
  ).trim()

let said = (subject: string, words: Words) => {
  if (words.lead) {
    return `${words.lead}: ${human(db, subject)}${
      words.body.trim() ? ` — ${words.body.trim()}` : ''
    }`
  }
  let title = titleOf(subject)
  let head = `${human(db, subject)}${title ? ` — ${title}` : ''}`
  return words.body.trim() ? `${head} — ${words.body.trim()}` : head
}

// The attention ladder. It performs the chosen delivery but owns no outcome
// component: callers settle their own entity with the returned fact. Words
// carry their writer so a relayed comment or letter keeps the asker's byline.
export let deliver = (
  to: string,
  subject: string,
  words: Words,
  cast: Cast,
): Outcome => {
  if (!to) return { error: 'no recipient' }
  try {
    let up = awake(to)
    if (up) return { via: `cast S-${up.num}` }

    // A settled managed session still owns one input door: a comment aimed at
    // it. The comment effect resumes the provider thread.
    let managed = db.prepare(
      `select 1 from session where eid = ? and origin = 'managed'`,
    ).get(to)
    if (managed) {
      let c = uuid()
      let t = trace()
      let out = apply(
        db,
        [
          {
            eid: c,
            name: 'doc',
            comp: { title: '', body: said(subject, words) },
          },
          { eid: c, name: 'comment', comp: { target_eid: to } },
        ],
        t,
        words.by,
      )
      cast(out)
      dispatch(out, t, (n, e) => console.warn(`deliver resume ${n} —`, e))
      return { via: `commented ${human(db, to)}` }
    }

    // A project with nobody home starts an operator on the subject task.
    let project = db.prepare('select 1 from project where eid = ?').get(to)
    if (project) {
      let isTask = db.prepare('select 1 from task where eid = ?').get(subject)
      if (!isTask) {
        return {
          error: `nobody awake and ${human(db, subject)} is not spawnable`,
        }
      }
      let provider = Object.keys(adapters).find((k) => k != 'fake') ?? 'fake'
      let made = spawnChanges(rows(snapshot(db)), {
        task: subject,
        provider,
        model: adapters[provider].models[0],
      })
      let t = trace()
      let note: Change[] = words.body.trim() && !words.lead
        ? [
          {
            eid: uuid(),
            name: 'doc',
            comp: { title: '', body: words.body.trim() },
          },
        ]
        : []
      if (note.length) {
        note.push({
          eid: note[0].eid,
          name: 'comment',
          comp: { target_eid: subject },
        })
      }
      let out = apply(db, [...note, ...made.changes], t, words.by)
      cast(out)
      dispatch(out, t, (c, e) => console.warn(`deliver spawn ${c} —`, e))
      return { via: `spawned ${human(db, made.eid)}` }
    }

    // An addressed entity hears the same sentence as mail. The mail effect
    // owns its envelope outcome; this caller records that it chose the rung.
    let addressed = db.prepare('select 1 from email where eid = ?').get(to)
    if (addressed) {
      let m = uuid()
      let t = trace()
      let title = titleOf(subject)
      let out = apply(
        db,
        [
          {
            eid: m,
            name: 'doc',
            comp: {
              title: words.lead
                ? `${words.lead}: ${human(db, subject)}`
                : `Look at ${human(db, subject)}${title ? ` — ${title}` : ''}`,
              body: words.body.trim() ||
                `You are asked to look at ${said(subject, { body: '' })}.`,
            },
          },
          { eid: m, name: 'mail', comp: { target_eid: subject } },
          { eid: m, name: 'deliver', comp: { to } },
        ],
        t,
        words.by,
      )
      cast(out)
      dispatch(out, t, (c, e) => console.warn(`deliver mail ${c} —`, e))
      return { via: `mailed ${human(db, to)}` }
    }

    return {
      error: `no door: ${
        human(db, to)
      } is not awake, spawnable-at, or addressed`,
    }
  } catch (e) {
    return { error: String(e).slice(0, 500) }
  }
}

export let settle = (eid: string, outcome: Outcome, cast: Cast) =>
  'via' in outcome
    ? delivered(eid, outcome.via, cast)
    : errored(eid, outcome.error, cast)
