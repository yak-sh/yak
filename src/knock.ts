// The knock resolver: a knock is the artifact of an attention ask —
// bring target_eid to to_eid's attention NOW — and this effect is the
// ladder that makes "now" true, stamping what it did (delivery) so
// every knock debugs itself. The cast is the first rung for free: a
// running session's channel plugin hears the broadcast the moment the
// knock commits. Words never live in the knock — they ride as a plain
// comment on the target in the same batch. SERVER-ONLY (imports db).
import { apply, db, snapshot } from './db.ts'
import { reachable } from './door.ts'
import { dispatch, trace } from './effects.ts'
import { type Change, idOf, uuid } from './types.ts'
import { rows, spawnChanges } from './client.ts'
import { adapters } from './adapters.ts'

type Cast = (changes: Change[]) => void
type Row = Record<string, string | number | null>

let now = () => new Date().toISOString()

// The one writer for the stamped trio — outcomes never cross apply(),
// so the stamp broadcasts its own full row (mail.ts's rule).
let stamp = (eid: string, patch: Row, cast: Cast) => {
  let cols = Object.keys(patch)
  db.prepare(
    `update knock set ${cols.map((c) => `"${c}" = ?`).join(', ')}
     where eid = ?`,
  ).run(...cols.map((c) => patch[c]), eid)
  let row = db.prepare('select * from knock where eid = ?').get(eid)
  if (row) {
    cast([{ eid, name: 'knock', comp: row as Record<string, unknown> }])
  }
}

let human = (eid: string) => {
  let r = rows(snapshot(db)).find((x) => x.eid == eid)
  return r ? idOf(r) : eid
}

// The most recent comment on the target — the words that rode the
// knock's batch (or the latest ask); a minute is the batch's horizon.
let wordsFor = (target: string): string => {
  let r = db.prepare(
    `select d.body from comment c
     join doc d on d.eid = c.eid
     join created cr on cr.eid = c.eid
     where c.target_eid = ?
     and cr.at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 minute')
     order by cr.at desc limit 1`,
  ).get(target) as { body: string } | undefined
  return String(r?.body ?? '')
}

// Who is awake for an identity: a session wearing that actor_eid (or the
// session itself) with a reachable content door (door.ts — liveness, never
// origin). Newest first, because that is the order the doors close in: a
// /clear leaves the old row behind and the higher num is the live one.
let awake = (to: string): { eid: string; num: number } | undefined =>
  (db.prepare(
    `select s.eid, e.num from session s join entity e on e.eid = s.eid
     where s.eid = ? or s.actor_eid = ?
     order by e.num desc`,
  ).all(to, to) as { eid: string; num: number }[])
    .find((s) => reachable(s.eid))

// The ladder. Every rung stamps; a knock with no door is an error, not
// a silence — the artifact must say why nobody heard it.
export let knocked =
  (cast: Cast) => (eid: string, comp: Record<string, unknown>) => {
    let to = String(comp.to_eid ?? '')
    let target = String(comp.target_eid ?? '')
    let done = (delivery: string) =>
      stamp(eid, { acted_at: now(), delivery }, cast)
    let fail = (error: string) => stamp(eid, { acted_at: now(), error }, cast)
    // Who asked. The knock's own provenance is the author of anything it
    // sends on their behalf.
    let knocker = () =>
      (db.prepare('select "by" from created where eid = ?')
        .get(eid) as { by: string | null } | undefined)?.by ?? null
    try {
      // 1: someone with that identity is reachable — the cast already
      // delivered (channel plugin / comms bus); the stamp names them.
      let up = awake(to)
      if (up) return done(`cast S-${up.num}`)
      // 2: an actor with a repo and nobody awake — spawn onto the
      // target task; the session boots holding the ask.
      let project = db.prepare(
        'select 1 from project where eid = ?',
      ).get(to)
      if (project) {
        let isTask = db.prepare('select 1 from task where eid = ?').get(target)
        if (!isTask) {
          return fail(`nobody awake and ${human(target)} is not spawnable`)
        }
        let provider = Object.keys(adapters).find((k) => k != 'fake') ?? 'fake'
        let made = spawnChanges(rows(snapshot(db)), {
          task: target,
          provider,
          model: adapters[provider].models[0],
        })
        let t = trace()
        let out = apply(db, made.changes, t)
        cast(out)
        dispatch(out, t, (c, e) => console.warn(`knock spawn ${c} —`, e))
        return done(`spawned ${human(made.eid)}`)
      }
      // 3: a person (or anything addressed) — the knock rides mail; the
      // mail effect owns delivery and its own audit trail.
      let addressed = db.prepare('select 1 from email where eid = ?').get(to)
      if (addressed) {
        let words = wordsFor(target)
        let m = uuid()
        let t = trace()
        let out = apply(
          db,
          [
            {
              eid: m,
              name: 'doc',
              comp: {
                title: `knock: ${human(target)}`,
                body: words || `You are asked to look at ${human(target)}.`,
              },
            },
            { eid: m, name: 'mail', comp: { to, target_eid: target } },
            // Signed by whoever knocked — the letter carries their words.
            // An unnamed writer would sign it by fallback, as the owner.
          ],
          t,
          knocker(),
        )
        cast(out)
        dispatch(out, t, (c, e) => console.warn(`knock mail ${c} —`, e))
        return done(`mailed ${human(to)}`)
      }
      // 4: a settled session keeps its own door — commenting on it
      // resumes it (sessions.ts commented); the knock records the miss.
      fail(`no door: ${human(to)} is not awake, spawnable-at, or addressed`)
    } catch (e) {
      fail(String(e).slice(0, 500))
    }
  }
