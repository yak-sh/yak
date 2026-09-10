// Prose in this graph is content-addressed: a body is stored once in
// `blob_text` and every column holding it keeps only its address. The read side
// resolves it back, so nothing above storage ever sees a hash — and a database
// written before the move is migrated once, exactly, on open.
import { assertEquals } from '@std/assert'
import { address } from '@yaks/blob'
import type { Bundle, Comp } from '@yaks/graph'
import { open } from './store.ts'

let bodyOf = (b: Bundle, comp = 'content') =>
  (b[comp] as Comp | undefined)?.body

Deno.test('blob prose deduplicates across properties, survives reopen and migrates legacy text exactly', async () => {
  let dir = Deno.makeTempDirSync()
  let path = dir + '/test.db'
  let h = open(path)
  try {
    let body = 'shared instruction'
    await h.g.apply([
      { entity: { eid: 'a' }, content: { body } },
      { entity: { eid: 'b' }, doc: { body } },
    ])
    assertEquals(h.db.prepare('select count(*) as n from blob_text').get(), {
      n: 1,
    })
    assertEquals(h.db.prepare('select body from content').get(), {
      body: address(body),
    })
    assertEquals(bodyOf((await h.g.read('.content'))[0]), body)
    assertEquals((await h.g.read('.doc.body="shared instruction"')).length, 1)
    // Simulate the pre-blob schema: marker absent and all prose stored inline.
    // A hash-looking legacy string must remain that string, not be dereferenced.
    h.db.exec(
      "delete from harness_upgrade; update content set body = '" +
        address(body) + "'; update doc set body = 'legacy'",
    )
    h.close()
    h = open(path)
    assertEquals(bodyOf((await h.g.read('.content'))[0]), address(body))
    assertEquals(bodyOf((await h.g.read('.doc'))[0], 'doc'), 'legacy')
    h.close()
    // Reopening an already-migrated database is a no-op: the marker holds.
    h = open(path)
    assertEquals(bodyOf((await h.g.read('.content'))[0]), address(body))
    await h.g.apply([{
      entity: { eid: 'a' },
      content: { body: 'updated' },
      $was: { content: { body: address(address(body)) } },
    }])
    assertEquals(bodyOf((await h.g.read('.content'))[0]), 'updated')
  } finally {
    h.close()
    Deno.removeSync(dir, { recursive: true })
  }
})
