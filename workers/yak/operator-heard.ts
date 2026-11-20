// Whether an answer from the apps an Operator reaches carries words someone
// it does not work for wrote (T-1064): a row an app's code wrote, one a person
// outside every space it reaches wrote, or one a visitor who never signed in
// wrote (a stamp with `via` and no `by`). Rules carry the writer that fired
// them, so a member's ordinary reads keep every tool.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { line } from '@yaks/query'
import { authors } from '@yaks/provenance/authorship'
import { idOf } from '@yaks/platform/listing'
import { appNotice } from '@yaks/platform/operator-source'
import type { Directory } from './directory.ts'
import type { Reach } from './reach.ts'

type Stamp = { by?: string | { eid: string } | null; via?: string | null }

let eidsOf = (out: Bundle[]) => [...new Set(out.map((b) => b.entity.eid))]

/** Reads may project away a notice's source and hearsay mark. Read those
 * again by identity, including for notices already kept by older code. */
export let heardIn = async (g: Pick<Graph, 'read'>, out: Bundle[]) => {
  let eids = eidsOf(out)
  if (!eids.length) return false
  let rows = await g.read(
    line`.entity.eid=${eids}&(.heard|.operator_request.channel=app|(.notice&.system))&.fields=heard,operator_request.channel,notice,system,channel,content.body`,
  )
  return rows.some((b) =>
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

/** Whether an app or a stranger wrote any row `out` names, read through `g`, the
 * graph over `reach`: one query for their stamps (the reach's `get` answers
 * these rows without them), and the directory asked only
 * about a writer who is neither `person`, a reached space's Operator, nor
 * (then) one of those spaces' members. */
export let strangerWrote = async (
  g: Pick<Graph, 'read'>,
  dir: Pick<Directory, 'members' | 'peopleOrApps' | 'browserOwners'>,
  reach: Reach[],
  person: string,
  out: Bundle[],
) => {
  let eids = eidsOf(out)
  if (!eids.length) return false
  let { anonymous, by } = writersOf(
    await g.read(line`.entity.eid=${eids}&.fields=created,updated,authorship`),
  )
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
