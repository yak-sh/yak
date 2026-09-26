import { assertEquals } from '@std/assert'
import { raise, scan, select } from '@yaks/sql'
import { harness } from './testing.ts'

Deno.test('blob-backed graph remains writable after SQL failure and rolls back the whole batch', async () => {
  let h = await harness()
  try {
    h.sql.query({
      t: 'create trigger',
      name: 'refuse_doc',
      timing: 'before',
      event: 'insert',
      on: 'doc',
      body: [select({ cols: [raise('abort', 'test refusal')] })],
    })
    let error: unknown
    try {
      await h.g.apply([{
        entity: { eid: 'refused' },
        doc: { body: 'must roll back' },
      }])
    } catch (caught) {
      error = caught
    }
    assertEquals((error as Error).message, 'test refusal')
    assertEquals(scan(h.sql, 'blob_text'), [])
    assertEquals(await h.g.read('.doc&*'), [])
    h.sql.query({ t: 'drop', kind: 'trigger', name: 'refuse_doc' })
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
