// Reference predicates keep cached projections across unrelated owner writes,
// while changes to their referents and visibility still change the answer.
import { equal, ok, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { loadVocab } from '@yaks/vocab'
import { archetypeDoc } from '@yaks/archetype/vocab'
import { archetypes } from '../archetype/plugin.ts'
import { open } from './db.ts'
import { storage } from './mod.ts'
import { lit } from '@yaks/sql'

let vocab = loadVocab([kernelDoc, archetypeDoc, {
  $defs: {
    session: { component: true, type: 'object', properties: {} },
    doc: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' }, body: { type: 'string' } },
    },
    notified: { component: true, type: 'object', properties: {} },
    apply_receipt: { component: true, type: 'object', properties: {} },
  },
}], [kernelKeywords])
let id = (i: number) =>
  `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`
let d = open(':memory:'),
  s = storage(d, vocab, {
    derived: {
      'doc.body': { stable: true, tag: 'text', expr: () => lit('derived') },
    },
  })
s.install()
let query = d.query, reads = 0
d.query = (stmt) => {
  if (stmt.t == 'select' || stmt.t == 'raw') reads++
  return query(stmt)
}
let g = graph({ vocab, storage: s, plugins: [archetypes()] })
await g.apply([
  { entity: { eid: id(1) }, doc: {} },
  { entity: { eid: id(2) }, session: {} },
  ...Array.from({ length: 382 }, (_, i) => ({
    entity: { eid: id(i + 10) },
    doc: {},
  })),
])
await g.apply(
  Array.from({ length: 535 }, (_, i) => ({
    entity: { eid: id(1000 + i) },
    comment: { target: id(10 + i % 382) },
    $actor: { by: id(1), via: id(1) },
  })),
  { trusted: true },
)
let q = '.comment !notified !created.via.session .fields=comment.target'
let opts = { visibility: { entity: '!apply_receipt' } }
let warm = async (query = q) => {
  await g.read(query, opts)
  await g.read(query, opts)
}
await warm()
await g.apply([{
  entity: { eid: id(2000) },
  doc: { title: 'unrelated' },
  $actor: { by: id(1), via: id(1) },
}], { trusted: true })
let before = reads, held = await g.read(q, opts), reused = reads - before
await g.apply([{ entity: { eid: id(1) }, session: {} }])
let session = await g.read(q, opts)
await g.apply([{ entity: { eid: id(1) }, session: null }])
let person = await g.read(q, opts)
await warm()
await g.apply([{
  entity: { eid: id(1000) },
  created: { via: id(2) },
}], { trusted: true })
let moved = await g.read(q, opts)
let masked = await g.read(q, {
  visibility: { components: { session: ".entity.eid!='" + id(2) + "'" } },
})
let hidden = await g.read(q, {
  visibility: { components: { created: '!comment' } },
})
test('a large projected answer survives unrelated writes within its cache bound', () => {
  equal(held.length, 535)
  equal(reused, 0)
})
test('referenced presence and root references invalidate a kept projection', () => {
  equal(session.length, 0)
  equal(person.length, 535)
  equal(moved.length, 534)
  ok(!moved.some((b) => b.entity.eid == id(1000)))
})
test('component masks retain their own reference-predicate answers', () => {
  equal(masked.length, 535)
  equal(hidden.length, 535)
})
let propertyQuery = '.comment.target.doc.title=news .fields=entity.eid'
await warm(propertyQuery)
await g.apply([{ entity: { eid: id(10) }, doc: { title: 'news' } }])
let property = await g.read(propertyQuery, opts)
test('a referenced property edit changes an otherwise unselected owner answer', () => {
  equal(property.map((b) => b.entity.eid), [id(1000), id(1382)])
})
let alternate = '.comment | .doc.title=match .fields=entity.eid'
await warm(alternate)
await g.apply([{
  entity: { eid: id(2001) },
  doc: { title: 'match', body: 'value' },
}])
let added = await g.read(alternate, opts)
test('unknown values that can match an alternative still invalidate its answer', () => {
  equal(added.length, 536)
  ok(added.some((b) => b.entity.eid == id(2001)))
})
d.close()

let dir = Deno.makeTempDirSync({ prefix: 'memo-reference-' })
let a = open(dir + '/graph.db'), b = open(dir + '/graph.db')
let one = storage(a, vocab), two = storage(b, vocab)
one.install()
two.install()
let first = graph({ vocab, storage: one, plugins: [archetypes()] })
let second = graph({ vocab, storage: two, plugins: [archetypes()] })
let external: number, schema: number
try {
  await first.apply([
    { entity: { eid: id(1) }, doc: {} },
    { entity: { eid: id(10) }, doc: {} },
    ...Array.from({ length: 200 }, (_, i) => ({
      entity: { eid: id(1000 + i) },
      comment: { target: id(10) },
      $actor: { by: id(1), via: id(1) },
    })),
  ], { trusted: true })
  await first.read(q, opts)
  await first.read(q, opts)
  await second.apply([{ entity: { eid: id(1) }, session: {} }])
  external = (await first.read(q, opts)).length
  await second.apply([{ entity: { eid: id(1) }, session: null }])
  await first.read(q, opts)
  await first.read(q, opts)
  b.query({ t: 'create table', name: 'unrelated', cols: [{ name: 'v' }] })
  schema = (await first.read(q, opts)).length
} finally {
  b.close()
  a.close()
  Deno.removeSync(dir, { recursive: true })
}
test('packed answers observe another connection and schema changes', () => {
  equal(external, 0)
  equal(schema, 200)
})
