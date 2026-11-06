// What leaves a space's Operator when someone removes a row from it
// (operator_remove): the row, and everything that exists only because of it.
// A task takes its comments, the sessions it contains and their lines; a
// conversation its own lines (a fork's, not those it inherits); a wake-up or
// subscription the requests it fired; a request what it told them in their
// Updates.
import type { Bundle, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { operatorStore } from './operator-store.ts'

type Store = ReturnType<typeof operatorStore>
type Reader = Pick<Graph, 'get' | 'read'>

/** The eids that go with `ids`, each once, the named ones first. */
export let removal = async (g: Reader, ids: string[]): Promise<string[]> => {
  let gone = new Set<string>()
  let take = async (eid: string): Promise<void> => {
    if (gone.has(eid)) return
    gone.add(eid)
    let [row] = await g.get([eid])
    let links = row?.task ? await g.read(`.contains .edge.from=${eid}`) : []
    let hung = [
      ...await g.read(`.comment.target=${eid}`),
      ...await g.read(`.operator_request.about=${eid}`),
      ...await g.read(`.operator_request.task=${eid}`),
      ...links,
      ...row?.session ? await g.read(`.entry.session=${eid}`) : [],
    ].map((b) => b.entity.eid)
    let told = row?.operator_request ? [derivedEid('operator-told|' + eid)] : []
    let sessions = links.map((b) => String((b.edge as { to: string }).to))
    for (let next of [...hung, ...told, ...sessions]) await take(next)
  }
  for (let eid of ids) await take(eid)
  let found = await g.get([...gone])
  return found.filter((b): b is Bundle => !!b && !b.tombstone)
    .map((b) => b.entity.eid)
}

/** Removes `ids` and what goes with them; answers the eids removed. */
export let remove = async ({ g }: Store, ids: string[]) => {
  let eids = await removal(g, ids)
  if (eids.length) {
    await g.apply(eids.map((eid) => ({ entity: { eid }, $delete: true })), {
      trusted: true,
    })
  }
  return eids
}
