import { assertEquals } from '@std/assert'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { graph } from '@yaks/graph'
import { compile } from '@yaks/sql'
import { absent, and, or, parse, present } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { mem, shop } from './harness.ts'
import { rows, storage } from './mod.ts'
import { Database } from './db.ts'

let vocab = loadVocab([...shop.docs, archetypeDoc, {
  $defs: { marker: { type: 'object' } },
}])
Deno.test('archetype query golden: presence/kind, value joins, boolean, paths, reverse and aggregates', () => {
  let driver = mem()
  let s = storage(driver, vocab)
  s.install()
  let g = graph({ storage: s, vocab, plugins: [archetypes()] })
  g.apply([
    { entity: { eid: 'a' }, doc: {}, marker: {} },
    {
      entity: { eid: 'b' },
      doc: { title: 'B' },
      product: { price: 4, maker: 'a' },
    },
    { entity: { eid: 'c' }, product: { maker: 'stub' } },
    { entity: { eid: 'r' }, review: { product: 'b', stars: 5 }, marker: {} },
  ])
  for (
    let q of [
      '.doc',
      '.doc!',
      '!doc',
      '!.doc',
      '.doc=',
      '?doc',
      '.marker!',
      '.doc! !product',
      '.kind=doc',
      '.kind=products',
      '.kind=review',
      '.doc! .price>=4',
      '.doc.title=',
      '.doc! .doc.title=',
      '.doc! .count!',
      '.product! .tally=product.status',
      '.doc! .order=title .limit=1',
      '.product.maker.marker!',
      '.product.maker.marker=',
      '.reviews.marker!',
      '.reviews!.marker!',
    ]
  ) {
    let old = compile(parse(q), vocab)
    assertEquals(rows(driver, vocab, q), driver.query(old.sql, old.params), q)
  }
  let bool = and(or(present('doc'), present('product')), absent('marker'))
  let old = compile(bool, vocab)
  assertEquals(rows(driver, vocab, bool), driver.query(old.sql, old.params))
})

Deno.test('archetype query/gather see new sets, rollback and reused descriptor ids', () => {
  let driver = mem()
  let s = storage(driver, vocab)
  s.install()
  let g = graph({ storage: s, vocab, plugins: [archetypes()] })
  let ids = (q: string) => s.read(q).map((b) => b.entity.eid)
  assertEquals(ids('.marker!'), [])
  driver.exec('savepoint outer')
  g.apply([{ entity: { eid: 'rolled-back' }, marker: {} }])
  assertEquals(ids('.marker!'), ['rolled-back'])
  driver.exec('rollback to outer; release outer')
  // A fresh writer learns a different set at the rolled-back descriptor's id.
  let other = graph({ storage: s, vocab, plugins: [archetypes()] })
  other.apply([{ entity: { eid: 'doc' }, doc: {} }])
  assertEquals(ids('.marker!'), [])
  assertEquals(ids('.doc!'), ['doc'])
  other.apply([{ entity: { eid: 'doc' }, marker: {} }])
  assertEquals(ids('.marker!'), ['doc'])
  driver.exec('savepoint remove')
  other.apply([{ entity: { eid: 'doc' }, marker: null }])
  assertEquals(ids('.marker!'), [])
  driver.exec('rollback to remove; release remove')
  assertEquals(ids('.marker!'), ['doc'])
})

Deno.test('archetype plans and gathers observe commits from another SQLite handle', () => {
  let dir = Deno.makeTempDirSync({ prefix: 'archetype-read-' })
  let first = new Database(`${dir}/graph.sqlite`)
  let second = new Database(`${dir}/graph.sqlite`)
  first.exec('pragma journal_mode=wal')
  let afterCatalog: (() => void) | undefined
  let driver = (db: Database) => ({
    query: (
      sql: string,
      params: Parameters<ReturnType<Database['prepare']>['all']>,
    ) => {
      let stmt = db.prepare(sql)
      let result
      try {
        result = stmt.all(...params)
      } finally {
        stmt.finalize()
      }
      if (db == first && sql == 'select entity, tables from archetype') {
        let hook = afterCatalog
        afterCatalog = undefined
        hook?.()
      }
      return result
    },
    exec: (sql: string) => db.exec(sql),
  })
  try {
    let d1 = driver(first)
    let d2 = driver(second)
    let reader = storage(d1, vocab)
    reader.install()
    let writer = storage(d2, vocab)
    writer.install()
    let g = graph({ storage: writer, vocab, plugins: [archetypes()] })
    assertEquals(reader.read('.marker!'), [])
    g.apply([{ entity: { eid: 'new' }, marker: {} }])
    assertEquals(reader.read('.marker!').map((b) => b.entity.eid), ['new'])
    g.apply([{ entity: { eid: 'new' }, marker: null, doc: {} }])
    assertEquals(reader.read('.marker!'), [])
    assertEquals(reader.read('.doc!').map((b) => b.entity.eid), ['new'])
    // A raw writer has not yet classified its row: fallback remains exact.
    writer.tx((tx) => tx.patch([{ entity: { eid: 'raw' }, marker: {} }]))
    assertEquals(reader.read('.marker!').map((b) => b.entity.eid), ['raw'])
    reader.install()
    assertEquals(reader.read('.marker!').map((b) => b.entity.eid), ['raw'])
    // A writer adds one owner of an existing shape and one of a new shape
    // AFTER planning. A stale catalog with a fresh entity scan would return
    // two matches: neither the old (one) nor the new (three) snapshot.
    afterCatalog = () => {
      writer.tx((tx) => {
        tx.patch([{
          entity: {
            eid: 'same-set',
            archetype: reader.tx((tx) => tx.get(['raw']))[0].entity.archetype,
          },
          marker: {},
        }])
        g.apply([{ entity: { eid: 'new-set' }, marker: {}, product: {} }])
      })
    }
    assertEquals(reader.rows('.marker! .count!'), [{ value: '', n: 1 }])
    assertEquals(reader.rows('.marker! .count!'), [{ value: '', n: 3 }])
    first.exec('drop table marker')
    let smaller = loadVocab([...shop.docs, archetypeDoc])
    storage(d1, smaller).install()
    assertEquals(reader.tx((tx) => tx.get(['raw']))[0].marker, undefined)
  } finally {
    first.close()
    second.close()
    Deno.removeSync(dir, { recursive: true })
  }
})
