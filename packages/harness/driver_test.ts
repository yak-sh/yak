import { assertEquals } from '@std/assert'
import { open } from './store.ts'

Deno.test('blob-backed graph remains writable after SQL failure and rolls back the whole batch', async () => {
  let h = open(':memory:')
  try {
    h.sql.exec(`create trigger refuse_doc before insert on doc
      begin select raise(abort, 'test refusal'); end`)
    let error: unknown
    try {
      await h.g.apply([{
        entity: { eid: 'refused' },
        doc: { body: 'must roll back' },
      }])
    } catch (caught) {
      error = caught
    }
    // sqlite3_finalize reports the prior step failure too; both errors stay
    // inspectable rather than a cleanup error replacing the original.
    assertEquals(error instanceof AggregateError, true)
    assertEquals((error as AggregateError).errors[0].message, 'test refusal')
    assertEquals(h.sql.query('select * from blob_text', []), [])
    assertEquals(await h.g.read('.doc&*'), [])
    h.sql.exec('drop trigger refuse_doc')
    await h.g.apply([{
      entity: { eid: 'accepted' },
      doc: { body: 'accepted text' },
    }])
    assertEquals((await h.g.read('.doc&*'))[0].doc, {
      body: 'accepted text',
      title: null,
    })
  } finally {
    h.close()
  }
})
