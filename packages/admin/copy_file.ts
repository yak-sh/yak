import * as fs from '@yaks/file/io'
import { open } from '@yaks/sqlite/db'
import { CallError } from '@yaks/tools/errors'
import type { Target } from './copy.ts'

// Each run owns its open file. Removing or replacing the public destination
// during a page fetch must never unlink a connection another copy still uses.
// Removing the destination directory itself ends the copy: it holds people's
// private words, so a removed destination is never made again, and the copy
// says why it failed instead of the journal or rename error the removal caused.
export let copyFile = (to: string, slug: string): Target => {
  fs.mkdirSync(to, { recursive: true })
  let dir = fs.makeTempDirSync({ dir: to, prefix: '.copy-' })
  let path = `${dir}/store.db`
  let sql
  try {
    sql = open(path, { wal: false })
    // A private file, published only once whole, needs no commit to reach the
    // disk: a commit a page and an ANALYZE a table each waited on an fsync,
    // a quarter of a copy's time. Neither pragma stays with the file.
    sql.query({ t: 'pragma', name: 'synchronous', value: 'off' })
    sql.query({ t: 'pragma', name: 'journal_mode', value: 'memory' })
  } catch (error) {
    fs.removeSync(dir, { recursive: true })
    throw error
  }
  let closed = false
  return {
    ...sql,
    close: (complete = false) => {
      if (closed) return
      closed = true
      try {
        sql.close()
        if (!present(dir)) {
          throw new CallError('to', `${to} was removed while the copy ran`)
        }
        if (complete) fs.renameSync(path, `${to}/${slug}.db`)
      } finally {
        fs.removeSync(dir, { recursive: true, force: true })
      }
    },
  }
}

/** Whether `slug`'s copy is in `to` already. */
export let copiedTo = (to: string, slug: string): boolean =>
  present(`${to}/${slug}.db`)

let present = (path: string) => {
  try {
    fs.lstatSync(path)
    return true
  } catch (error) {
    if (fs.isNotFound(error)) return false
    throw error
  }
}
