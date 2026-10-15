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
    let named = (src?: unknown) =>
      !!src && typeof src == 'object' && 't' in src && src.t == 'table' &&
      'name' in src && src.name == 'content'
    if (
      s.t == 'select' &&
      (named(s.from) || s.joins?.some((j) => named(j.src)))
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

// What an owner's text reads as, and how many content reads that took.
let read = (fields: Field[], eid: string) => {
  reads = 0
  return [
    sources(measured, fields, [owners.get(eid)!]).map((s) => s.text),
    reads,
  ]
}

test('embedding still reads an owner whose descriptor is missing', () => {
  assertEquals(read(text, 'null'), [['null\nSpoken'], 1])
  assertEquals(read(text, 'missing'), [['missing\nSpoken'], 1])
})

test('embedding still reads an owner no earlier row described', () => {
  assertEquals(read(text, 'no-doc'), [['Spoken'], 1])
})

test('embedding still reads unscoped fields', () => {
  assertEquals(read(unscoped, 'unscoped'), [['Loose'], 1])
})
