// Production server entrypoint. Keep this module deliberately tiny: ownership
// of the graph is established before the runtime module graph is imported.
// server_runtime.ts reaches live_db.ts at module evaluation, so a static import
// here would move SQLite open/migration back in front of the barrier.
import {
  acquireServerOwnership,
  OWNER_BUSY_EXIT,
  ownerGraphPath,
  ServerOwnershipBusy,
} from './server_ownership.ts'

// A few process tests drive these server seams directly. The type queries are
// erased and therefore cannot evaluate server_runtime.ts before ownership.
export let aged: typeof import('./server_runtime.ts').aged
export let broadcastObservation:
  typeof import('./server_runtime.ts').broadcastObservation
export let maintain: typeof import('./server_runtime.ts').maintain
export let retiredDataDoors:
  typeof import('./server_runtime.ts').retiredDataDoors

let graph = ownerGraphPath()
try {
  acquireServerOwnership(graph)
} catch (e) {
  console.error(`tasks: ${(e as Error).message}`)
  Deno.exit(e instanceof ServerOwnershipBusy ? OWNER_BUSY_EXIT : 1)
}

try {
  let runtime = await import('./server_runtime.ts')
  aged = runtime.aged
  broadcastObservation = runtime.broadcastObservation
  maintain = runtime.maintain
  retiredDataDoors = runtime.retiredDataDoors
} catch (e) {
  // Keep ownership until process exit closes every descriptor together. A
  // failed module evaluation may have opened SQLite before a later boot step
  // threw, so releasing the lock explicitly here would create a gap.
  console.error('tasks: server boot failed —', e)
  Deno.exit(1)
}
