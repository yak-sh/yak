// Prose in this graph is content-addressed: a body is stored once in
// `blob_text` and every property holding it keeps only its address. The read
// side resolves it back, so nothing above storage ever sees a hash, and a
// reopened file reads the same prose it was written with.
import { assertEquals } from '@std/assert'
import { address } from '@yaks/blob'
import type { Bundle, Comp } from '@yaks/graph'
import { scan, tally } from '@yaks/sql'
import { open } from './store.ts'

let bodyOf = (b: Bundle, comp = 'content') =>
  (b[comp] as Comp | undefined)?.body

Deno.test('blob prose deduplicates across properties and survives reopen', async () => {
  let dir = Deno.makeTempDirSync()
  let path = dir + '/test.db'
  let h = open(path)
  try {
    let body = 'shared instruction'
    await h.g.apply([
      { entity: { eid: 'a' }, content: { body } },
      { entity: { eid: 'b' }, doc: { body } },
    ])
    assertEquals(tally(h.sql, 'blob_text'), 1)
    assertEquals(scan(h.sql, 'content', undefined, ['body']), [{
      body: address(body),
    }])
    assertEquals(bodyOf((await h.g.read('.content&*'))[0]), body)
    assertEquals((await h.g.read('.doc.body="shared instruction"&*')).length, 1)
    h.close()
    // Reopening reads the prose back, never its address hashed again.
    h = open(path)
    assertEquals(bodyOf((await h.g.read('.content&*'))[0]), body)
    await h.g.apply([{
      entity: { eid: 'a' },
      content: { body: 'updated' },
      $was: { content: { body: address(body) } },
    }])
    assertEquals(bodyOf((await h.g.read('.content&*'))[0]), 'updated')
  } finally {
    h.close()
    Deno.removeSync(dir, { recursive: true })
  }
})
