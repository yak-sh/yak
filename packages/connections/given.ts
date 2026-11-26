// What follows a key given for a connection (`connection_given`, ./vocab.json):
// once its new credential is sealed in the vault, its integration's `check` is
// called, the key goes to each place the connection's `keep` names, through
// the keeper the host lends under that name (@yaks/host/keepers), and the
// tasks that ask for it are completed. This package names no keeper: where a
// key goes is the ask's data, and how it gets there is the host's.
//
// A key the service refuses is the person's to give again: the connection is
// marked `broken`, so the task's paste box shows once more, and the run ends
// without failing. A keeper that cannot keep it fails the run, which the pool
// retries and reports, and the task stays open.

import type { Handler } from '@yaks/effects'
import type { Bundle, Comp, Eid } from '@yaks/graph'
import type { Keeper, Place } from '@yaks/host/keepers'
import { line } from '@yaks/query'
import { reveal, type Vault } from '@yaks/secrets'
import { call, type Ctx } from './connections.ts'
import { known } from './integrations.ts'
import { ASKS, CONNECTION } from './identity.ts'

/** What it needs of the host: its graph, its vault, and the keepers it lends. */
export type Host = {
  graph: Ctx['graph']
  vault: Vault
  keepers?: Readonly<Record<string, Keeper>>
  fetch?: typeof fetch
}

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

/** The keeper `place` names, or why it cannot keep the key now. */
let keeperOf = (host: Host, place: Place): Keeper => {
  let keeper = host.keepers?.[place.via]
  if (!keeper) throw new Error(`nothing lends the keeper ${place.via}`)
  let waiting = keeper.waiting?.()
  if (waiting) throw new Error(`the keeper ${place.via} is ${waiting}`)
  return keeper
}

/** Whether the service takes the key, by the integration's check; a key with
 * no check is taken as given. */
let works = async (host: Host, eid: Eid, check?: string): Promise<boolean> => {
  if (!check) return true
  let [method, url] = check.split(' ')
  let res = await call(
    { graph: host.graph, vault: host.vault, fetch: host.fetch },
    eid,
    new Request(url, { method }),
  )
  await res.body?.cancel()
  if (res.ok) return true
  if (res.status == 401 || res.status == 403) return false
  throw new Error(`${check} answered ${res.status}`)
}

/** The handler: check, keep, then complete the asks. */
export let given = (host: Host): Handler => async (event, _tx, write) => {
  let eid = event.entity.eid
  let read = host.graph.read
  let [b] = await read(line`.entity.eid=${eid}&.${CONNECTION}&*`)
  let c = comp(b, CONNECTION)
  if (c.status != 'connected') return
  let keep = (c.keep ?? []) as Place[]
  let asks = await read(line`.edge.to=${eid}&.${ASKS}&.edge`)
  if (!keep.length && !asks.length) return
  let i = await known(read, String(c.integration))
  if (!await works(host, eid, i?.check)) {
    await write([{ entity: { eid }, [CONNECTION]: { status: 'broken' } }])
    return
  }
  if (keep.length) {
    let name = String(comp(b, 'secret').name)
    let value = await reveal(host.vault, name, { env: () => undefined })
    if (!value) throw new Error(`${name} holds no key to keep`)
    for (let place of keep) await keeperOf(host, place).keep(place.at, value)
  }
  let tasks = asks.map((l) => String(comp(l, 'edge').from))
  let open = tasks.length
    ? await read(line`.entity.eid=${tasks}&.task&!completed&!cancelled`)
    : []
  if (open.length) {
    await write(
      open.map((t) => ({ entity: { eid: t.entity.eid }, completed: {} })),
    )
  }
}
