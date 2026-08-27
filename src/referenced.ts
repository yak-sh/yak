// Referenced edges (D-21262, T-21316): every reference an entry's text makes
// — entity ids (T-7, M-42) and page urls — lands as an `entry →referenced→
// target` edge, minted by a post-commit effect. Past tense on purpose: it
// records a citation after the fact, pure mechanics, no inference. Distinct
// from `recalled` (deliberate memory surfacing) so mining can tell a thought
// that floated up from an entity the text itself names — which is why a
// recall-floater entry is skipped here: its citations are the machinery's
// own, already recorded as `recalled` edges.
import { apply } from './db.ts'
import { db } from './live_db.ts'
import { type Change } from './types.ts'
import { referencedChanges } from './reference_changes.ts'
export {
  type Cites,
  cites,
  historicalReferenced,
  referencedChanges,
} from './reference_changes.ts'

// Component tables key by the integer `entity` spine id (D-18866); this module
// speaks eids, so raw SQL translates at the boundary, recall.ts's way.
let OWNED = `entity = (select id from entity where eid = ?)`

// The effect: a new entry's text is parsed and its citations land as edges.
// Fires on `entry` created; reads whatever content committed with it. A
// recall floater (the one machine-authored entry whose whole body is
// citations) is skipped — see the header.
export let referencedEntry = (cast: (c: Change[]) => void) => (eid: string) => {
  if (db.prepare(`select 1 from recalled where ${OWNED}`).get(eid)) return
  let row = db.prepare(`select body from content where ${OWNED}`).get(eid) as
    | { body?: string }
    | undefined
  let text = String(row?.body ?? '')
  if (!text) return
  let out = referencedChanges(db, eid, text)
  if (out.length) cast(apply(db, out))
}
