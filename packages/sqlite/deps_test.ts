// The driver tested here is the one every graph opens.
import './sqlitepath.ts'
import { Database } from './legacy.ts'
import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'

test('the driver opens a database a file URL names', async () => {
  let dir = await Deno.makeTempDir()
  try {
    let db = new Database(new URL(`file://${dir}/a%20b.db`))
    db.exec('create table t (x)')
    db.close()
    assertEquals((await Deno.stat(`${dir}/a b.db`)).isFile, true)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
