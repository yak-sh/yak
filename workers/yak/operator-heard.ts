// App answers are trusted when every row has known writers. A browser
// stamp can stand for a member who later claimed it.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { line } from '@yaks/query'
import { deliveryField } from '@yaks/mail'
import { authors } from '@yaks/provenance/authorship'
import { idOf } from '@yaks/platform/listing'
import { appNotice } from '@yaks/platform/operator-source'
import type { Directory } from './directory.ts'
import type { Reach } from './reach.ts'

type Stamp = { by?: string | { eid: string } | null; via?: string | null }

let eidsOf = (out: Bundle[]) => [...new Set(out.map((b) => b.entity.eid))]

let unsigned = (s?: Stamp | null) => !s?.by && !s?.via

let writersOf = (row: Bundle): Stamp[] =>
  row.delivered
    ? authors(row, (path, span) => !unsigned(span) || !deliveryField(row, path))
    : authors(row)

/** Whether the Operator's own store answered words, or a row that is
 * hearsay. Reads may project away a notice's source and hearsay mark, so
 * those are read again by identity, including for notices already kept by
 * older code. */
export let heardIn = async (g: Pick<Graph, 'read'>, out: Bundle[]) => {
  let eids = eidsOf(out)
  if (!eids.length) return false
  let rows = await g.read(
    line`.entity.eid=${eids}&.fields=created,heard,operator_request.channel,notice,system,channel,content.body`,
  )
  return rows.length < eids.length ||
    rows.some((b) =>
      b.heard || (b.operator_request as Comp | undefined)?.channel == 'app' ||
      appNotice(b, String((b.content as Comp | undefined)?.body ?? ''))
    )
}

/** Whether an app answer includes words whose writers cannot all be vouched
 * for. A projected row may omit its stamps, so read them again by identity. */
export let unvouched = async (
  g: Pick<Graph, 'read'>,
  dir: Pick<Directory, 'members' | 'browserOwners'>,
  reach: Reach[],
  person: string,
  operator: string,
  out: Bundle[],
) => {
  let eids = eidsOf(out)
  if (!eids.length) return false
  let rows = await g.read(
    line`.entity.eid=${eids}&.fields=created,updated,authorship,delivered,mail.to,mail.message_id`,
  )
  if (
    rows.length < eids.length || rows.some((b) => unsigned(b.created as Stamp))
  ) {
    return true
  }
  let writers = rows.map(writersOf)
  if (writers.some((row) => !row.length || row.some(unsigned))) {
    return true
  }
  let stamps = writers.flat()
  let by = new Set(stamps.flatMap((s) => s.by ? [idOf(s.by)] : []))
  let anonymous = [
    ...new Set(stamps.flatMap((s) => !s.by && s.via ? [s.via] : [])),
  ]
  if (anonymous.length) {
    let owners = await dir.browserOwners(anonymous)
    if (anonymous.some((via) => !owners.has(via))) return true
    for (let p of owners.values()) by.add(p)
  }
  let spaces = new Set([operator, ...reach.map((r) => r.space.eid)])
  let others = [...by].filter((p) => p != person && !spaces.has(p))
  if (!others.length) return false
  let members = new Set(
    (await Promise.all([...spaces].map((eid) => dir.members({ eid })))).flat(),
  )
  return others.some((p) => !members.has(p))
}
