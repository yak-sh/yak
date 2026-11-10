import * as fs from '@yaks/file/io'
import { open } from '@yaks/sqlite/db'
import type { Target } from './copy.ts'

// Each run owns its open file. Removing or replacing the public destination
// during a page fetch must never unlink a connection another copy still uses.
export let copyFile = (to: string, slug: string): Target => {
  fs.mkdirSync(to, { recursive: true })
  let dir = fs.makeTempDirSync({ dir: to, prefix: '.copy-' })
  let path = `${dir}/store.db`
  let sql
  try {
    sql = open(path, { wal: false })
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
        if (complete) fs.renameSync(path, `${to}/${slug}.db`)
      } finally {
        fs.removeSync(dir, { recursive: true })
      }
    },
  }
}
