import { assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { mem } from './harness.ts'
import { storage } from './mod.ts'

let vocab = loadVocab([{
  $defs: {
    entity: { properties: { num: { type: 'number', stamped: true } } },
    entry: { properties: { seq: { type: 'number' } } },
    task: { properties: { target: { type: 'string', ref: 'entity' } } },
  },
}])

for (let backend of ['sqlite', 'ram']) {
  Deno.test(
    backend + ': numbering excludes facets across the whole batch',
    () => {
      let opts = { number: { except: ['entry'] } }
      let s = backend == 'sqlite'
        ? storage(mem(), vocab, opts)
        : ram(vocab, opts)
      s.install()
      s.tx((tx) => {
        tx.patch([
          { entity: { eid: 'task' }, task: { target: 'entry' } },
          { entity: { eid: 'entry' }, entry: { seq: 1 }, task: {} },
          { entity: { eid: 'second' }, task: {} },
        ])
        assertEquals(tx.get(['entry'])[0].entity, { eid: 'entry' })
        assertEquals(tx.get(['task'])[0].entity.num, 1)
        assertEquals(tx.get(['second'])[0].entity.num, 2)
        tx.patch([{ entity: { eid: 'second' }, entry: { seq: 2 } }])
        assertEquals(tx.get(['second'])[0].entity, { eid: 'second' })
        tx.patch([{ entity: { eid: 'third' }, task: {} }])
        assertEquals(tx.get(['third'])[0].entity.num, 3)
      })
    },
  )
}

Deno.test('SQLite migration retains historic high-water across clearing and reopen', () => {
  let d = mem()
  let old = storage(d, vocab)
  old.install()
  old.tx((tx) =>
    tx.patch([
      { entity: { eid: 'task' }, task: {} },
      { entity: { eid: 'entry' }, entry: { seq: 1 } },
    ])
  )
  // Represents a legacy allocator's last number, higher than surviving tasks.
  d.exec("update entity set num = 90000 where eid = 'entry'")
  let s = storage(d, vocab, { number: { except: ['entry'] } })
  for (let i = 0; i < 2; i++) {
    s.install()
    d.exec(
      'update entity set num = null where id in (select entity from entry)',
    )
  }
  s.tx((tx) => {
    tx.patch([{ entity: { eid: 'next' }, task: {} }])
    assertEquals(tx.get(['next'])[0].entity.num, 90001)
    assertEquals(tx.get(['task'])[0].entity.num, 1)
    assertEquals(tx.get(['entry'])[0].entity, { eid: 'entry' })
  })
})
