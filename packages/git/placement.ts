// Filesystem contexts are stable across linked checkouts and directory defaults.
// Only explicitly host-local entry points may select this computer.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { mint } from '@yaks/graph'

/** One canonical root workspace per computer filesystem. */
export let filesystemEid = (machine: string): string =>
  derivedEid('computer filesystem|' + machine)

/** Select the explicitly local computer, creating its inventory once. A
 * directory is never a computer identity. Remote APIs never call this helper. */
let select = async (g: Graph): Promise<Bundle> => {
  let found = await g.read('.machine.address=local://')
  if (found.length > 1) throw Error('Multiple computers claim local://')
  let machine = found[0]?.entity.eid ?? mint()
  let eid = filesystemEid(machine)
  let [known] = await g.get([eid])
  if (!known?.workspace) {
    await g.apply([
      ...found.length
        ? []
        : [{ entity: { eid: machine }, machine: { address: 'local://' } }],
      { entity: { eid }, workspace: { machine, root: '/' } },
    ])
    ;[known] = await g.get([eid])
  }
  let place = known!.workspace as Comp
  if (place.machine != machine || place.root != '/' || place.sandbox) {
    throw Error(
      'Canonical local filesystem workspace has conflicting placement',
    )
  }
  return known!
}

let selecting = new WeakMap<Graph, Promise<Bundle>>()
export let localFilesystem = (g: Graph): Promise<Bundle> => {
  let current = selecting.get(g)
  if (current) return current
  let next = select(g).finally(() => selecting.delete(g))
  selecting.set(g, next)
  return next
}
