import { hosting } from './hosting.ts'
// The graph floor and durable writes now belong to @yaks/client. Only the
// obsolete whole-graph database cleanup remains here.
let LEGACY = 'tasks'

// Drop the dead `tasks` database. Fire-and-forget: a delete waits for every
// tab still holding it open, and nothing here depends on when it lands.
export let forgetLegacy = () => {
  if (hosting().storage) return
  try {
    ;(globalThis as { indexedDB?: IDBFactory }).indexedDB?.deleteDatabase(
      LEGACY,
    )
  } catch { /* no storage, nothing to forget */ }
}
