import { assert, assertEquals } from '@std/assert'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { mem, shop } from './harness.ts'
import { get, storage } from './mod.ts'
import { get as census } from './fixtures/census.ts'

let vocab = loadVocab([...shop.docs, archetypeDoc, {
  $defs: {
    marker: { type: 'object' },
    sample: { type: 'object', properties: { present: { type: 'string' } } },
  },
}])

Deno.test('archetype gather golden: nulls, tags, refs, derived, stubs, graves, order and duplicates', () => {
  let driver = mem()
  let s = storage(driver, vocab)
  s.install()
  let g = graph({ storage: s, vocab, plugins: [archetypes()] })
  g.apply([
    { entity: { eid: 'a' }, doc: {}, marker: {}, sample: { present: 'real' } },
    { entity: { eid: 'b' }, product: { maker: 'a', price: 4 } },
    { entity: { eid: 'c' }, product: { maker: 'stub' } },
    { entity: { eid: 'dead' }, doc: { title: 'gone' } },
  ])
  g.apply([{ entity: { eid: 'dead' }, $delete: true }])
  let ids = ['b', 'a', 'missing', 'stub', 'c', 'a', 'dead']
  let opts = {
    derived: {
      'doc.title': {
        tag: 'text' as const,
        expr: () => "coalesce(doc.title, 'derived')",
      },
    },
  }
  assertEquals(get(driver, vocab, ids), census(driver, vocab, ids))
  assertEquals(get(driver, vocab, ids, opts), census(driver, vocab, ids, opts))
  assertEquals(get(driver, vocab, []), [])
  assertEquals(get(driver, vocab, ['a'])[0].doc, { title: null, body: null })
  assertEquals(get(driver, vocab, ['a'])[0].marker, {})
  assertEquals(get(driver, vocab, ['a'])[0].sample, { present: 'real' })
  assert(get(driver, vocab, ['stub'])[0].entity.archetype)
})

Deno.test('archetype gather golden: wide sparse sets, chunks and a smaller reader vocabulary', () => {
  let driver = mem()
  let wide = loadVocab([...vocab.docs, {
    $defs: Object.fromEntries(Array.from({ length: 405 }, (_, i) => [
      `facet${i}`,
      { type: 'object', properties: { value: { type: 'string' } } },
    ])),
  }])
  let s = storage(driver, wide)
  s.install()
  driver.exec(`with recursive n(x) as
    (values(1) union all select x+1 from n where x<4101)
    insert into entity(eid,num) select 'owner-'||x, 100+x from n;
    insert into facet404(entity,value) select id,'last chunk' from entity where eid='owner-4101';
    insert into doc(entity,title) select id,'first' from entity where eid='owner-1'`)
  // Physical table sets, not the smaller reader's vocabulary, determine shape.
  s.install()
  let ids = Array.from({ length: 4101 }, (_, i) => `owner-${i + 1}`)
  ids.push('missing', ids[0])
  assertEquals(get(driver, wide, ids), census(driver, wide, ids))
  assertEquals(get(driver, vocab, ids), census(driver, vocab, ids))
  let g = graph({ storage: s, vocab: wide, plugins: [archetypes()] })
  g.apply([{ entity: { eid: ids[0] }, facet0: {} }])
  assertEquals(get(driver, wide, ids), census(driver, wide, ids))
  g.apply([{ entity: { eid: ids[0] }, facet0: null }])
  assertEquals(get(driver, wide, ids), census(driver, wide, ids))
})

Deno.test('classified gathers select only present tables and only their owners', () => {
  let db = mem()
  let asked: { sql: string; params: unknown[] }[] = []
  let driver = {
    ...db,
    query: (sql: string, params: Parameters<typeof db.query>[1]) => {
      asked.push({ sql, params })
      return db.query(sql, params)
    },
  }
  let s = storage(driver, vocab)
  s.install()
  let g = graph({ storage: s, vocab, plugins: [archetypes()] })
  g.apply([
    { entity: { eid: 'a' }, doc: {} },
    { entity: { eid: 'b' }, doc: {}, marker: {} },
    { entity: { eid: 'c' }, marker: {} },
  ])
  asked = []
  get(driver, vocab, ['a', 'b', 'c'])
  assertEquals(asked.length, 4) // spine + created + doc + marker; no census
  assert(!asked.some((s) => /union all|from "product"/.test(s.sql)))
  for (let q of asked.slice(2)) {
    assertEquals(JSON.parse(String(q.params[0])).length, 2)
  }
  asked = []
  s.tx((tx) => tx.get(['a']))
  assertEquals(asked.length, 3) // spine + created + doc
  asked = []
  s.tx((tx) => tx.pick(['a'], ['marker']))
  assertEquals(asked.length, 1) // known missing; no projection probe
  asked = []
  s.rows('.doc.title=hello')
  assertEquals(asked.length, 1) // value-only queries do not load the catalog
  asked = []
  s.rows('.doc! .marker!')
  assertEquals(asked.length, 3) // completeness, one shared catalog, entity scan
  assert(asked[2].sql.includes('"entity"."archetype" in ('))
  assert(!/join "(doc|marker)"/.test(asked[2].sql))
})
