// Whether a tool's answer brings an Operator words someone it does not work
// for wrote (T-1064, T-1860). Words a tool composed are heard, since nothing
// says who wrote what they show: only rows can be vouched for. A row is heard
// when an app's code wrote it, a person outside every space the Operator
// reaches did, a visitor who never signed in did (a stamp with `via` and no
// `by`), or nobody did: the kernel door files letters, texts, chat messages,
// webhooks and receipts with no writer, and they carry words from outside
// (T-1879). Rules carry the writer that fired them, so a member's ordinary
// reads and writes keep every tool. An effect's later stamp on a member's row
// (a sent letter's `mail.to`) has no writer either, and leaves the row its
// filer's.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { line } from '@yaks/query'
import { authors } from '@yaks/provenance/authorship'
import { idOf } from '@yaks/platform/listing'
import { appNotice } from '@yaks/platform/operator-source'
import type { Directory } from './directory.ts'
import type { Reach } from './reach.ts'

type Stamp = { by?: string | { eid: string } | null; via?: string | null }

let eidsOf = (out: Bundle[]) => [...new Set(out.map((b) => b.entity.eid))]

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

/** The writers whose words survive, and the browsers of signed-out writers.
 * Older rows carry only their two surviving provenance stamps. */
export let writersOf = (rows: (Bundle | undefined)[]) => {
  let stamps = rows.flatMap(authors) as Stamp[]
  return {
    anonymous: [
      ...new Set(stamps.flatMap((s) => s.via && !s.by ? [s.via] : [])),
    ],
    by: new Set(stamps.flatMap((s) => s.by ? [idOf(s.by)] : [])),
  }
}

/** Whether a row was filed by nobody: its creation names no writer. */
let unsigned = (row: Bundle) => {
  let { by, via } = (row.created ?? {}) as Stamp
  return !by && !via
}

/** Whether `out` is anything but rows `g`, the graph over `reach`, holds,
 * none of which an app or a stranger wrote (T-1860): a command's display of
 * rows or a page's text is heard whoever wrote what it shows, so a tool that
 * keeps every tool for the turn answers rows. One query reads the rows'
 * stamps (the reach's `get` answers rows without them), and the directory is
 * asked only about a writer who is neither `person`, a reached space's
 * Operator, nor (then) one of those spaces' members. */
export let unvouched = async (
  g: Pick<Graph, 'read'>,
  dir: Pick<Directory, 'members' | 'peopleOrApps' | 'browserOwners'>,
  reach: Reach[],
  person: string,
  out: Bundle[],
) => {
  let eids = eidsOf(out)
  if (!eids.length) return false
  let rows = await g.read(
    line`.entity.eid=${eids}&.fields=created,updated,authorship`,
  )
  if (rows.length < eids.length || rows.some(unsigned)) return true
  let { anonymous, by } = writersOf(rows)
  if (reach.some(({ app }) => by.has(app.eid))) return true
  if (anonymous.length) {
    let owners = await dir.browserOwners(anonymous)
    if (anonymous.some((via) => !owners.has(via))) return true
    for (let p of owners.values()) by.add(p)
  }
  let spaces = new Map(reach.map((r) => [r.space.eid, r.space]))
  let others = [...by].filter((p) => p != person && !spaces.has(p))
  if (!others.length) return false
  let members = new Set(
    (await Promise.all([...spaces.values()].map((s) => dir.members(s)))).flat(),
  )
  others = others.filter((p) => !members.has(p))
  return await dir.peopleOrApps(others)
}
