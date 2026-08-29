// The pre-open, process-lifetime owner barrier for a serving process.
//
// This module must stay storage-library-free. In particular, never import
// db.ts/live_db.ts (or a module that reaches them): server.ts calls acquire,
// and only the winner dynamically imports the runtime that opens SQLite.
import { basename, dirname, join, resolve } from 'node:path'

export const OWNER_BUSY_EXIT = 73

export class ServerOwnershipBusy extends Error {}

// Repeated rather than imported from db.ts on purpose: deriving the configured
// filename cannot be allowed to initialize any owner-storage module.
export let ownerGraphPath = () =>
  Deno.env.get('DB_PATH') ?? `${Deno.env.get('HOME')}/.tasks/tasks.db`

// Resolve symlinks as well as `.`/`..`, or two spellings of one database could
// lock two pathnames. A not-yet-created database canonicalizes through its
// existing parent instead.
export let canonicalGraphPath = (db: string) => {
  let path = resolve(db)
  try {
    return Deno.realPathSync(path)
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e
    return join(Deno.realPathSync(dirname(path)), basename(path))
  }
}

export let ownershipPath = (db: string) =>
  `${canonicalGraphPath(db)}-server.lock`

let held: Deno.FsFile | undefined

let ownerDescription = (file: Deno.FsFile) => {
  try {
    file.seekSync(0, Deno.SeekMode.Start)
    let bytes = new Uint8Array(4096)
    let n = file.readSync(bytes) ?? 0
    let text = new TextDecoder().decode(bytes.subarray(0, n)).trim()
    if (!text) return ''
    let value = JSON.parse(text) as { pid?: unknown; started?: unknown }
    let pid = typeof value.pid == 'number' ? ` pid ${value.pid}` : ''
    let started = typeof value.started == 'string'
      ? ` since ${value.started}`
      : ''
    return pid || started ? ` (owner${pid}${started})` : ''
  } catch {
    return ''
  }
}

export let acquireServerOwnership = (db = ownerGraphPath()) => {
  if (held) {
    throw new Error('server ownership was acquired twice in one process')
  }
  // In-memory databases share a spelling but not storage. They are used by
  // isolated tests and have no owner file to protect.
  if (db == ':memory:') return
  // connect() historically creates a fresh graph's parent. Ownership now runs
  // first, so preserve that boot contract without importing storage code.
  Deno.mkdirSync(dirname(resolve(db)), { recursive: true })
  let canonical = canonicalGraphPath(db)
  let path = ownershipPath(db)
  let file = Deno.openSync(path, {
    create: true,
    read: true,
    write: true,
    mode: 0o600,
  })
  if (!file.tryLockSync(true)) {
    let description = ownerDescription(file)
    file.close()
    throw new ServerOwnershipBusy(
      `server ownership refused for ${canonical}${description}: another ` +
        `server owns this graph. Stop the owning server before booting a ` +
        `replacement; SQLite was not opened.`,
    )
  }
  try {
    // A durable breadcrumb makes an unattended refusal actionable. Never
    // unlink this file: flock belongs to its inode, and replacing the path
    // would let two servers lock different objects.
    Deno.truncateSync(path, 0)
    file.seekSync(0, Deno.SeekMode.Start)
    file.writeSync(new TextEncoder().encode(
      JSON.stringify({
        pid: Deno.pid,
        started: new Date().toISOString(),
        db: canonical,
      }) + '\n',
    ))
    file.syncSync()
    held = file
  } catch (e) {
    file.close()
    throw e
  }
}

export let releaseServerOwnership = () => {
  let file = held
  held = undefined
  file?.close()
}
