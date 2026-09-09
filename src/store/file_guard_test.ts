import { assertEquals, assertThrows } from '@std/assert'
import { DatabaseSync } from './sqlite.ts'
import { assertNotGraphFile } from './file_guard.ts'

Deno.test('raw readers refuse an open graph and its sidecars through aliases', () => {
  let root = Deno.makeTempDirSync(), path = `${root}/graph.db`
  let db = new DatabaseSync(path)
  let alias = `${root}/alias.db`
  Deno.symlinkSync(path, alias)
  try {
    assertThrows(() => assertNotGraphFile(alias), Error, 'open SQLite')
    assertThrows(() => assertNotGraphFile(`${path}-wal`), Error, 'open SQLite')
    assertThrows(
      () => assertNotGraphFile(`${path}-journal`),
      Error,
      'open SQLite',
    )
    assertNotGraphFile(`${root}/prose.txt`)
  } finally {
    db.close()
  }
  assertEquals(assertNotGraphFile(path), undefined)
  Deno.removeSync(root, { recursive: true })
})
