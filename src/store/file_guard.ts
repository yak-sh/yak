// Protect SQLite's POSIX locks from unrelated file handles in this process.
// Closing any descriptor for an open database inode can release locks held by
// SQLite, so file readers must refuse the database and its WAL/SHM sidecars.

import { resolve } from 'node:path'

type OpenGraph = { path: string; dev?: number | null; ino?: number | null }
let opened = new Set<OpenGraph>()

export let canonicalFile = (path: string) => {
  try {
    return Deno.realPathSync(path)
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e
    return resolve(path)
  }
}

let identity = (path: string) => {
  try {
    let { dev, ino } = Deno.statSync(path)
    return { dev, ino }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e
    return {}
  }
}

export let registerGraphFile = (path: string): OpenGraph | undefined => {
  if (path == ':memory:') return
  let entry = { path: canonicalFile(path), ...identity(path) }
  opened.add(entry)
  return entry
}

export let unregisterGraphFile = (entry: OpenGraph) => opened.delete(entry)

export let assertNotGraphFile = (path: string) => {
  let key = canonicalFile(path)
  let file = identity(path)
  for (let db of opened) {
    if (
      key == db.path || key == `${db.path}-wal` ||
      key == `${db.path}-shm` || key == `${db.path}-journal` ||
      (file.dev != null && file.ino != null &&
        file.dev == db.dev && file.ino == db.ino)
    ) {
      throw new Error(
        `refusing raw file access to an open SQLite database: ${path}`,
      )
    }
  }
}
