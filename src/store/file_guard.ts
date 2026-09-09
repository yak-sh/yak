// Protect SQLite's POSIX locks from unrelated file handles in this process.
// Closing any descriptor for an open database inode can release locks held by
// SQLite, so file readers must refuse the database and its WAL/SHM sidecars.

import { resolve } from 'node:path'

let opened = new Map<string, number>()

export let canonicalFile = (path: string) => {
  try {
    return Deno.realPathSync(path)
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e
    return resolve(path)
  }
}

export let registerGraphFile = (path: string) => {
  if (path == ':memory:') return
  let key = canonicalFile(path)
  opened.set(key, (opened.get(key) ?? 0) + 1)
}

export let unregisterGraphFile = (path: string) => {
  if (path == ':memory:') return
  let key = canonicalFile(path), n = opened.get(key) ?? 0
  if (n <= 1) opened.delete(key)
  else opened.set(key, n - 1)
}

export let assertNotGraphFile = (path: string) => {
  let key = canonicalFile(path)
  for (let db of opened.keys()) {
    if (
      key == db || key == `${db}-wal` || key == `${db}-shm` ||
      key == `${db}-journal`
    ) {
      throw new Error(
        `refusing raw file access to an open SQLite database: ${path}`,
      )
    }
  }
}
