// Text an entity is found by through another of its components: a transcript
// `entry` is found by its `content.body`, and nothing else carrying `content`
// is. The index is right whichever of the two rows a write lands first.

import { assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { fields, indexes } from './fields.ts'
import { adopt, heal, schema } from './ddl.ts'
import { find } from './search.ts'
import { by, insert, type Stmt, val } from '@yaks/sql'
import { mem, raised, SPINE, text as prose, TOMBSTONE } from './testing.ts'

let TABLES: Stmt[] = [
  SPINE,
  TOMBSTONE,
  raised(
    'content',
    { name: 'entity', type: 'integer', pk: true },
    prose('body'),
  ),
  raised('entry', { name: 'entity', type: 'integer', pk: true }, {
    name: 'seq',
    type: 'real',
  }),
]

let talk = loadVocab({
  $defs: {
    entity: { component: true, type: 'object', wire: false, properties: {} },
    content: {
      component: true,
      type: 'object',
      properties: { body: { type: 'string' } },
    },
    entry: {
      component: true,
      type: 'object',
      search: ['content.body'],
      properties: { seq: { type: 'number' } },
    },
  },
})

let text = fields(talk)

// A database with the tables, the index, and one entity per id; `said` writes
// the text, `entry` makes it an entry, in whichever order a test calls them.
let talking = () => {
  let db = mem()
  for (let s of [...TABLES, ...schema(text)]) db.query(s)
  for (let id = 1; id <= 4; id++) {
    db.query(insert('entity', { id, eid: `e${id}` }))
  }
  let said = (id: number, body: string) =>
    db.query(insert('content', { entity: id, body }))
  let entry = (id: number) => db.query(insert('entry', { entity: id, seq: id }))
  let found = (words: string) => find(db, text, words).map((h) => h.entity)
  return { db, said, entry, found }
}

Deno.test('a component names the text its entities are found by', () => {
  assertEquals(text, [{ comp: 'content', prop: 'body', on: 'entry' }])
  assertEquals(indexes(text), [
    { name: 'entry', comp: 'content', props: ['body'], on: 'entry' },
  ])
})

Deno.test('an entry is found by its text, whichever row lands first', () => {
  let t = talking()
  t.said(1, 'facets are about where things run')
  t.entry(1)
  t.entry(2)
  t.said(2, 'facets, not when')
  t.said(3, 'facets in a tool result')
  assertEquals(t.found('facets').sort(), ['e1', 'e2'])
  assertEquals(heal(t.db, text), [])
})

Deno.test('the index follows the text and the membership', () => {
  let t = talking()
  t.said(1, 'the daemon takes over')
  t.entry(1)
  t.db.query({
    t: 'update',
    table: 'content',
    set: { body: val('a worker') },
    where: by({ entity: 1 }),
  })
  assertEquals(t.found('daemon'), [])
  assertEquals(t.found('worker'), ['e1'])
  t.db.query({ t: 'delete', from: 'entry', where: by({ entity: 1 }) })
  assertEquals(t.found('worker'), [])
  t.entry(1)
  assertEquals(t.found('worker'), ['e1'])
  t.db.query({ t: 'delete', from: 'content', where: by({ entity: 1 }) })
  assertEquals(t.found('worker'), [])
  assertEquals(heal(t.db, text), [])
})

Deno.test('adopting an existing store indexes its entries once, and again changes nothing', () => {
  let db = mem()
  for (
    let s of [
      ...TABLES,
      insert('entity', { id: 1, eid: 'e1' }, { id: 2, eid: 'e2' }),
      insert('content', { entity: 1, body: 'plugins' }, {
        entity: 2,
        body: 'plugins',
      }),
      insert('entry', { entity: 1, seq: 1 }),
    ]
  ) db.query(s)
  assertEquals(adopt(db, text).recut, ['entry_fts'])
  assertEquals(find(db, text, 'plugins').map((h) => h.entity), ['e1'])
  let version = () =>
    db.query({ t: 'pragma', name: 'schema_version' })[0].schema_version
  let before = version()
  assertEquals(adopt(db, text), { recut: [], dropped: [], healed: [] })
  assertEquals(version(), before)
})
