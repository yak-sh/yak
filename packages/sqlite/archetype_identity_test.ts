// An archetype's descriptor is the set of its components' identities, in a
// store laid out by identity and in one laid out by label alike. A descriptor
// written before its words had identities (labels) still answers presence,
// counts and the audit until the migration rewrites it (T-162475).
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { archetypeDoc, archetypes, eidOf } from '@yaks/archetype'
import { graph, mint } from '@yaks/graph'
import { col, eq, select, table, val } from '@yaks/sql'
import { labelStored, loadVocab, type VocabDoc } from '@yaks/vocab'
import { minted } from '@yaks/vocab/minted'
import { mem } from './testing.ts'
import { drift, storage } from './mod.ts'

let words = JSON.parse(minted(
  JSON.stringify({
    $defs: {
      note: {
        component: true,
        properties: { title: { type: 'string' } },
      },
      tag: { component: true, properties: { name: { type: 'string' } } },
    },
  }),
  mint,
)) as VocabDoc
let v = loadVocab([archetypeDoc, words])
let id = (name: string) => v.comp(name)!.id!

let held = (d: ReturnType<typeof mem>, eid: string) =>
  JSON.parse(String(
    d.query(select({
      cols: [col('tables', 'a')],
      from: table('entity', 'e'),
      joins: [{
        how: 'cross',
        src: table('archetype', 'a'),
        on: eq(col('entity', 'a'), col('archetype', 'e')),
      }],
      where: eq(col('eid', 'e'), val(eid)),
    }))[0].tables,
  ))

for (let legacy of [false, true]) {
  test(`a ${legacy ? 'label' : 'UUID'} store describes a set by its component identities`, async () => {
    let d = mem()
    let s = storage(d, legacy ? labelStored(v) : v)
    s.install()
    let g = graph({ storage: s, vocab: v, plugins: [archetypes()] })
    await g.apply([
      { entity: { eid: 'both' }, note: { title: 'A' }, tag: { name: 'x' } },
      { entity: { eid: 'one' }, note: { title: 'B' } },
    ])
    assertEquals(held(d, 'both'), [id('note'), id('tag')].sort())
    assertEquals(
      (await g.read('.note&!tag')).map((b) => b.entity.eid),
      ['one'],
    )
    assertEquals(await g.rows('.tag .count'), [{ value: '', n: 1 }])
    assertEquals(drift(d).drifted, 0)
  })
}

test('a descriptor of labels answers presence, counts and the audit', async () => {
  let d = mem()
  let s = storage(d, v)
  s.install()
  let g = graph({ storage: s, vocab: v, plugins: [archetypes()] })
  await g.apply([
    { entity: { eid: 'old' }, note: { title: 'A' }, tag: { name: 'x' } },
  ])
  // Point the entity at the descriptor a store wrote before identities.
  let labels = eidOf(['note', 'tag'])
  await g.apply([{
    entity: { eid: labels },
    archetype: { tables: '["note","tag"]' },
  }])
  d.query({
    t: 'update',
    table: 'entity',
    set: {
      archetype: {
        t: 'sub',
        q: select({
          cols: [col('id')],
          from: table('entity'),
          where: eq(col('eid'), val(labels)),
        }),
      },
    },
    where: eq(col('eid'), val('old')),
  })
  assertEquals(held(d, 'old'), ['note', 'tag'])
  assertEquals((await g.read('.tag')).map((b) => b.entity.eid), ['old'])
  assertEquals(await g.read('.note&!tag'), [])
  assertEquals(await g.rows('.tag .count'), [{ value: '', n: 1 }])
  assertEquals(drift(d).drifted, 0)
  // A value-only patch leaves it there; losing a component moves it to the
  // set its identities describe.
  await g.apply([{ entity: { eid: 'old' }, note: { title: 'B' } }])
  assertEquals(held(d, 'old'), ['note', 'tag'])
  await g.apply([{ entity: { eid: 'old' }, tag: null }])
  assertEquals(held(d, 'old'), [id('note')])
})
