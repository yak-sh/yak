// The knock resolver: a knock is the artifact of an attention ask —
// bring target_eid to to_eid's attention NOW — and this effect is the
// ladder that makes "now" true, stamping what it did (delivery) so
// every knock debugs itself. The cast is the first rung for free: a
// running session's channel plugin hears the broadcast the moment the
// knock commits. Words never live in the knock — they ride as a plain
// comment on the target in the same batch. SERVER-ONLY (imports db).
import { db } from './db.ts'
import { deliver, settle, toOf } from './deliver.ts'
import { type Change } from './types.ts'

type Cast = (changes: Change[]) => void

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

// A deliberate knock stays an artifact. It supplies the words that rode beside
// it, then settles itself with the shared ladder's outcome.
export let knocked =
  (cast: Cast) => (eid: string, comp: Record<string, unknown>) => {
    let to = toOf(eid)
    let target = String(comp.target_eid ?? '')
    let by = (db.prepare('select "by" from created where eid = ?')
      .get(eid) as { by: string | null } | undefined)?.by
    settle(
      eid,
      deliver(to, target, { body: wordsFor(target), by, lead: 'knock' }, cast),
      cast,
    )
  }
