import { assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { mem } from './harness.ts'
import { mintSql, storage } from './mod.ts'

let vocab = loadVocab([{
  $defs: {
    entity: {
      component: true,
      properties: { num: { type: 'number', stamped: true } },
    },
    entry: {
      component: true,
      properties: { seq: { type: 'number' } },
    },
    task: {
      component: true,
      properties: { target: { type: 'string', ref: 'entity' } },
    },
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
  let old = storage(d, vocab, { number: true })
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

Deno.test('a mint may state the number it is adopting', () => {
  // What a store seeded from another store's export needs: an entity read as
  // 37574 there is 37574 here, and the sequence carries on past it rather than
  // handing the next arrival a number already in use.
  let d = mem()
  let s = storage(d, vocab, { number: true })
  s.install()
  for (let [eid, n] of [['old', 37574], ['older', 12]] as const) {
    let m = mintSql(eid, n)
    d.query(m.sql, m.params)
  }
  let none = mintSql('nameless', false)
  d.query(none.sql, none.params)
  s.tx((tx) => {
    tx.patch([{ entity: { eid: 'fresh' }, task: {} }])
    assertEquals(tx.get(['old'])[0].entity.num, 37574)
    assertEquals(tx.get(['older'])[0].entity.num, 12)
    assertEquals(tx.get(['nameless'])[0].entity, { eid: 'nameless' })
    assertEquals(tx.get(['fresh'])[0].entity.num, 37575)
  })
})

Deno.test('an adopting store takes the number a patch states', () => {
  // A store seeded from another store's export is TOLD the identity: a stated
  // number is the one the entity takes, a stated null leaves it unnumbered,
  // and the sequence carries on past whatever was stated.
  let s = storage(mem(), vocab, { number: true, adopt: true })
  s.install()
  s.tx((tx) => {
    tx.patch([
      { entity: { eid: 'old', num: 37574 }, task: {} },
      { entity: { eid: 'made', num: null }, task: {} },
      { entity: { eid: 'mine' }, task: {} },
    ])
    assertEquals(tx.get(['old'])[0].entity.num, 37574)
    assertEquals(tx.get(['made'])[0].entity, { eid: 'made' })
    assertEquals(tx.get(['mine'])[0].entity.num, 37575)
  })
})

Deno.test('a store that is not adopting mints its own numbers regardless', () => {
  let s = storage(mem(), vocab, { number: true })
  s.install()
  s.tx((tx) => {
    tx.patch([{ entity: { eid: 'old', num: 37574 }, task: {} }])
    assertEquals(tx.get(['old'])[0].entity.num, 1)
  })
})
