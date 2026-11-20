// The instructions an ask sent, kept once per distinct text: a
// `told{instructions}` row whose eid is their sha256, named by the ask as
// `sending{told}`, the way `offer{tools}` keeps the tools it sent. Asks
// repeat the same tens of kilobytes from one turn to the next, so an ask
// holds a name and the text is stored once.
//
// An input still selects instructions as text (`sending{instructions}`); a
// reader of what is in force takes either through {@link instructionsOf}.

import type { Bundle, Comp, Graph } from '@yaks/graph'
import { sha256 } from '@yaks/graph/sha256'

/** The `told` row holding `instructions`, named by their sha256.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { sha256 } from '@yaks/graph/sha256'
 * assertEquals(toldRow('Be brief.'), {
 *   entity: { eid: sha256('Be brief.') },
 *   told: { instructions: 'Be brief.' },
 * })
 * ```
 */
export let toldRow = (instructions: string): Bundle => ({
  entity: { eid: sha256(instructions) },
  told: { instructions },
})

/** The instructions a `sending` says: the text an input selected, or the
 * text of the `told` row an ask names. Undefined where it says none. */
export let instructionsOf = async (
  g: Pick<Graph, 'get'>,
  sending: Comp | undefined,
): Promise<string | undefined> => {
  if (typeof sending?.instructions == 'string') return sending.instructions
  let told = sending?.told
  if (typeof told != 'string') return undefined
  return (await toldOf(g, [told])).get(told)
}

/** The texts of the `told` rows named, by their eid; a name with no row is
 * left out. */
export let toldOf = async (
  g: Pick<Graph, 'get'>,
  names: Iterable<string>,
): Promise<Map<string, string>> => {
  let wanted = [...new Set(names)]
  if (!wanted.length) return new Map()
  let rows = await g.get(wanted, ['told'])
  return new Map(rows.flatMap((b) => {
    let text = (b?.told as Comp | undefined)?.instructions
    return typeof text == 'string' ? [[b.entity.eid, text]] : []
  }))
}
