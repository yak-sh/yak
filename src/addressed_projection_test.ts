import { assertEquals } from '@std/assert'
import { bareDb } from './testdb.ts'
import { apply } from './db.ts'
import { subserve } from './subserve.ts'
import { routeName } from './live.ts'
import type { Change } from './types.ts'

Deno.test('addressed route projects a face without shipping its transcript', () => {
  let db = bareDb()
  let eid = crypto.randomUUID()
  try {
    apply(db, [
      { eid, name: 'session', comp: { id: 'native' } },
      { eid, name: 'doc', comp: { title: 'Face', body: 'large transcript' } },
    ])
    let frames: { changes?: Change[]; fields?: unknown }[] = []
    let server = subserve(db, (f) => {
      if ('changes' in f) frames.push(f)
    })
    server.frame({
      sub: routeName(eid, 'doc.title,session.id'),
      q: `id=${eid}&.fields=doc.title,session.id`,
    })
    let frame = frames.at(-1)!
    assertEquals(!!frame.fields, true)
    assertEquals(frame.changes?.find((c) => c.name == 'doc')?.comp, {
      title: 'Face',
    })
    assertEquals(frame.changes?.some((c) => c.name == 'entity'), true)
  } finally {
    db.close()
  }
})
