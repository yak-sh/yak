// The thread ./checkpoint.ts asks: a connection per file, kept, and a PASSIVE
// checkpoint each time it is asked, answered once it ends.

import { parentPort } from 'node:worker_threads'
import { open, type Opened } from './db.ts'
import type { Done } from './checkpoint.ts'

let files = new Map<string, Opened>()

parentPort!.on('message', (path: string) => {
  let tell = (done: Done) => parentPort!.postMessage(done)
  try {
    let db = files.get(path) ?? open(path)
    files.set(path, db)
    db.query({ t: 'pragma', name: 'wal_checkpoint', value: 'passive' })
    tell({ path })
  } catch (e) {
    tell({ path, error: e instanceof Error ? e.stack ?? e.message : String(e) })
  }
})
