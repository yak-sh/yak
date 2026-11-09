// One connection per running checkpoint, released before its owner can finish
// closing. Opening never creates a file or installs another checkpoint hook.

import { parentPort } from 'node:worker_threads'
import { Database } from './legacy.ts'
import { configure } from './native.ts'
import { render } from '@yaks/sql'
import { type Done, perform, type Request } from './checkpoint.ts'

let open = (path: string) => {
  let db = new Database(path, { create: false })
  try {
    db.exec(render({ t: 'pragma', name: 'busy_timeout', value: 60_000 }).sql)
    configure(db, 'SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE', true)
    db.exec(render({ t: 'pragma', name: 'synchronous', value: 'normal' }).sql)
    return {
      checkpoint: () =>
        db.exec(
          render({ t: 'pragma', name: 'wal_checkpoint', value: 'passive' }).sql,
        ),
      close: () => db.close(),
    }
  } catch (error) {
    db.close()
    throw error
  }
}

parentPort!.on('message', (request: Request) => {
  let done: Done = { id: request.id, path: request.path }
  try {
    perform(request, open)
  } catch (e) {
    done.error = e instanceof Error ? e.stack ?? e.message : String(e)
  }
  parentPort!.postMessage(done)
})
