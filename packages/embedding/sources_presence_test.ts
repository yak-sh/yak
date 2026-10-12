// A descriptor already read for one text row proves which later rows exist.
import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { graph } from '@yaks/graph'
import { by, scan, type Statements, val } from '@yaks/sql'
import { storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { loadVocab } from '@yaks/vocab'
import { schema } from './ddl.ts'
import type { Field } from './fields.ts'
import { sources } from './sweep.ts'

let vocab = loadVocab([archetypeDoc, {
  $defs: {
    doc: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' }, body: { type: 'string' } },
    },
    content: {
      component: true,
      type: 'object',
      properties: { body: { type: 'string' } },
    },
    entry: { component: true, type: 'object' },
    draft: { component: true, type: 'object', embed: false },
  },
}])
let store = storage(open(':memory:'), vocab)
store.install()
let db = store.statements
for (let stmt of schema()) db.query(stmt)
let g = graph({ storage: store, vocab, plugins: [archetypes()] })
await g.apply([
  { entity: { eid: 'doc' }, doc: { title: 'Title', body: 'Body' } },
  {
    entity: { eid: 'unscoped' },
    doc: { title: ' ' },
    content: { body: 'Loose' },
  },
  ...['null', 'missing', 'no-doc'].map((eid) => ({
    entity: { eid },
    ...eid != 'no-doc' ? { doc: { title: eid } } : {},
    content: { body: 'Spoken' },
    entry: {},
  })),
])
let owners = new Map(
  scan(db, 'entity').map((r) => [String(r.eid), Number(r.id)]),
)
for (let eid of ['null', 'missing']) {
  db.query({
    t: 'update',
    table: 'entity',
    set: { archetype: val(eid == 'null' ? null : owners.get('doc')!) },
    where: by({ eid }),
  })
}
let text: Field[] = [
  { comp: 'doc', prop: 'title', not: ['draft'] },
  { comp: 'doc', prop: 'body', not: ['draft'] },
  { comp: 'content', prop: 'body', on: 'entry', not: ['draft'] },
]
let reads = 0
let measured: Statements = {
  ...db,
  query: (s) => {
    if (
      s.t == 'select' && !Array.isArray(s.from) &&
      s.from?.t == 'table' && s.from.name == 'content'
    ) {
      reads++
    }
    return db.query(s)
  },
}
let unscoped = text.concat({ comp: 'content', prop: 'body', not: ['draft'] })
for (let eid of ['doc', 'unscoped', 'null', 'missing', 'no-doc']) {
  sources(measured, text, [owners.get(eid)!])
}
sources(measured, unscoped, [owners.get('unscoped')!])

test('embedding skips text groups a read descriptor proves absent', () => {
  reads = 0
  assertEquals(
    sources(measured, text, [owners.get('doc')!]).map((s) => s.text),
    [
      'Title\nBody',
    ],
  )
  assertEquals(sources(measured, text, [owners.get('unscoped')!]), [])
  assertEquals(reads, 0)
})

test('embedding still reads missing metadata, unread owners and unscoped fields', () => {
  reads = 0
  for (let eid of ['null', 'missing', 'no-doc']) {
    assertEquals(
      sources(measured, text, [owners.get(eid)!]).map((s) => s.text),
      [eid == 'no-doc' ? 'Spoken' : `${eid}\nSpoken`],
    )
  }
  assertEquals(
    sources(measured, unscoped, [owners.get('unscoped')!]).map((s) => s.text),
    ['Loose'],
  )
  assertEquals(reads, 4)
})
