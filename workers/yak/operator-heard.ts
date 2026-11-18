// Whether an answer from the apps an Operator reaches carries words someone
// it does not work for wrote (T-1064): a row a person outside every space it
// reaches wrote or last changed, such as a grantee or a signed-in visitor to an
// open app, or one a visitor who never signed in wrote (a stamp that names
// where it came from, `via`, and nobody, `by`). The space's own people, its
// Operator and the rules a write fires (stamped with that write's writer) are
// never strangers, so a member's ordinary reads keep every tool.
import type { Bundle, Graph } from '@yaks/graph'
import { line } from '@yaks/query'
import { idOf } from '@yaks/platform/listing'
import type { Directory } from './directory.ts'
import type { Reach } from './reach.ts'

type Stamp = { by?: string | { eid: string } | null; via?: string | null }

/** Who wrote these rows: each `created` and `updated` writer, and whether a
 * visitor who never signed in wrote any of them. */
export let writersOf = (rows: (Bundle | undefined)[]) => {
  let stamps = rows.flatMap((b) =>
    [b?.created, b?.updated].filter(Boolean) as Stamp[]
  )
  return {
    anonymous: stamps.some((s) => s.via && !s.by),
    by: new Set(stamps.flatMap((s) => s.by ? [idOf(s.by)] : [])),
  }
}

/** Whether a stranger wrote any row `out` names, read through `g`, the
 * graph over `reach`: one query for their stamps (the reach's `get` answers
 * these rows without them), and the directory asked only
 * about a writer who is neither `person`, a reached space's Operator, nor
 * (then) one of those spaces' members. */
export let strangerWrote = async (
  g: Pick<Graph, 'read'>,
  dir: Pick<Directory, 'members' | 'persons'>,
  reach: Reach[],
  person: string,
  out: Bundle[],
) => {
  let eids = [...new Set(out.map((b) => b.entity.eid))]
  if (!eids.length) return false
  let { anonymous, by } = writersOf(
    await g.read(line`.entity.eid=${eids}&.fields=created,updated`),
  )
  if (anonymous) return true
  let spaces = new Map(reach.map((r) => [r.space.eid, r.space]))
  let others = [...by].filter((p) => p != person && !spaces.has(p))
  if (!others.length) return false
  let members = new Set(
    (await Promise.all([...spaces.values()].map((s) => dir.members(s)))).flat(),
  )
  others = others.filter((p) => !members.has(p))
  return others.length > 0 && (await dir.persons(others)).size > 0
}
