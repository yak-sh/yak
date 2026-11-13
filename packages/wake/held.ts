// One person's wakes: those set for them (`wake.for`), which run as them and
// are theirs to list and cancel. A host that serves several people from one
// graph (the space's Operator on yaks.app) lists and cancels by these, so one
// person never sees or ends another's.

import { addressed, type Bundle, type Eid, type Graph } from '@yaks/graph'
import { WAKE } from './comp.ts'

type G = Pick<Graph, 'read' | 'get' | 'apply' | 'address'>

/** The wakes set for `person` that will fire again, soonest first, whole. */
export let held = (g: Pick<Graph, 'read'>, person: Eid): Promise<Bundle[]> =>
  Promise.resolve(
    g.read(`.${WAKE}.for=${person}&.${WAKE}.at&.order=${WAKE}.at&*`),
  )

/** The wake `id` names (an eid, a short `#id` or a `W-` number) when it is
 * set for `person`, else `undefined`. */
export let theirs = async (
  g: Pick<G, 'get' | 'address'>,
  person: Eid,
  id: string,
): Promise<Bundle | undefined> => {
  let [row] = id ? await g.get(await addressed(g, [id])) : []
  let wake = row?.[WAKE] as { for?: Eid } | undefined
  return wake?.for == person ? row : undefined
}

/** Cancel the wake `id` names when it is set for `person`: it is deleted, so
 * it never fires again. Answers the wake cancelled, or `undefined` when
 * `person` has no such wake. */
export let cancel = async (
  g: Pick<G, 'get' | 'address' | 'apply'>,
  person: Eid,
  id: string,
  opts: Parameters<Graph['apply']>[1] = {},
): Promise<Bundle | undefined> => {
  let row = await theirs(g, person, id)
  if (row) await g.apply([{ entity: row.entity, $delete: true }], opts)
  return row
}
