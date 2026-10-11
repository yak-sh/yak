// Current trash state and its acknowledged dormancy delivery.
import type { ReadTx } from '@yaks/graph'
import { storeOf } from './door.ts'
import { KERNEL } from './meta.ts'
import { appOf, spaceOf, storeName } from './directory.ts'
import type { Namespace } from './door.ts'

/** The trash's calendar cadence; Cron Triggers only supply its heartbeat. */
export let DAILY = '20 4 * * *'

// Read the present on every attempt, including a restore that overtook a
// failed trash delivery. Space trash never changes an app's own trash mark.
let stateOf = async (tx: ReadTx, eid: string) => {
  let [row] = await tx.get([eid])
  if (!row?.app || row.tombstone) return null
  let app = appOf(row as Parameters<typeof appOf>[0])
  let [parent] = await tx.get([app.space])
  if (!parent?.space || parent.tombstone) return null
  let space = spaceOf(parent as Parameters<typeof spaceOf>[0])
  return {
    name: storeName(space, app),
    asleep: !!(row.trashed || parent.trashed),
  }
}

export let delivered = async (ns: Namespace, tx: ReadTx, eid: string) => {
  // A concurrent restore/trash can commit while the external call is in
  // flight. Before settling, deliver any newer state too. If this process
  // dies between delivery and settlement, the durable run reads it afresh.
  for (;;) {
    let state = await stateOf(tx, eid)
    if (!state) return
    let door = storeOf(ns, state.name)
    let response = await door(
      state.asleep ? '/dormant' : '/revive',
      { method: 'POST' },
      KERNEL,
    )
    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`)
    }
    await response.body?.cancel()
    let now = await stateOf(tx, eid)
    if (!now || now.name == state.name && now.asleep == state.asleep) return
  }
}
