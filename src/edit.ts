// The graph's Edit primitive (T-16357): a surgical old→new replacement on a
// doc's CURRENT body, guarded by the body the caller read (Change.was, the
// wire's compare-and-swap) so a concurrent edit is refused rather than
// clobbered — the two guarantees the file Edit tool gives, brought to doc.body.
//
// It lives here, not in client.ts, because it needs sha() and sha.ts pulls
// node:crypto — server-only. client.ts is in the browser module graph
// (browser_test guards that), so the one builder that hashes stays out of it.
// `task edit` and MCP `doc_edit` are its only callers, both server-side.
import { type Change, idOf } from './types.ts'
import { type Row } from './client.ts'
import { sha } from './sha.ts'

// `old` must occur exactly once unless `all`, the file Edit tool's
// unique-or-explicit contract; a `was` mismatch at apply() hands back the
// current body so the caller re-reads and retries.
export let editChanges = (
  row: Row,
  old: string,
  replacement: string,
  all = false,
): Change[] => {
  if (!row.comps.doc) throw new Error(`${idOf(row)} has no doc body to edit`)
  if (!old) throw new Error('edit: the text to replace is empty')
  let body = String(row.comps.doc.body ?? '')
  let hits = body.split(old).length - 1
  if (hits == 0) {
    throw new Error(
      `edit: not found in ${idOf(row)}'s body: ${JSON.stringify(old)}`,
    )
  }
  if (hits > 1 && !all) {
    throw new Error(
      `edit: ${hits} matches in ${idOf(row)}'s body — pass replace_all, or ` +
        `include surrounding text to make the match unique`,
    )
  }
  let next = all
    ? body.split(old).join(replacement)
    : body.replace(old, replacement)
  if (next == body) {
    throw new Error('edit: the replacement leaves the body unchanged')
  }
  return [{
    eid: row.eid,
    name: 'doc',
    comp: { body: next },
    was: { body: sha(body) },
  }]
}
