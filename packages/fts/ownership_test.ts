// Repeated ranking probes must fit the engine while screening ownership at
// the record and through its references, before a hidden hit takes a place.
import { equal, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { absent, and, eq, or, parse } from '@yaks/query'
import { compile, insert } from '@yaks/sql'
import { bounded } from '../sqlite/testing.ts'
import { schema as tables } from '../sqlite/mod.ts'
import { fields } from './fields.ts'
import { schema } from './ddl.ts'
import { search } from './compile.ts'

let owners = Array.from({ length: 8 }, (_, i) => `owner${i}`)
let texts = ['doc', 'note', 'memo']
let vocab = loadVocab({
  $defs: Object.fromEntries([
    ...owners.map((name) => [name, {
      component: true,
      properties: { person: { type: 'string', ref: 'entity' } },
    }]),
    ...['link', 'via'].map((name) => [name, {
      component: true,
      properties: { parent: { type: 'string', ref: 'entity' } },
    }]),
    ...texts.map((name) => [name, {
      component: true,
      properties: { text: { type: 'string', search: true } },
    }]),
  ]),
})
let db = bounded({ vdbeOp: 25_000, compoundSelect: 5, variableNumber: 100 })
// Fit the same graph layout the query compiler reads, then its text indexes.
for (let stmt of [...tables(vocab), ...schema(fields(vocab))]) db.query(stmt)
for (
  let [id, eid] of [
    [1, 'reader'],
    [2, 'other'],
    [3, 'seen'],
    [4, 'hidden'],
    [5, 'parent'],
    [6, 'private'],
  ] as const
) {
  db.query(insert('entity', { id, eid }))
}
db.query(insert('owner0', { entity: 5, person: 2 }))
db.query(insert('via', { entity: 4, parent: 5 }))
for (let id of [3, 4, 6]) {
  db.query(insert('doc', { entity: id, text: 'Pruning' }))
}
db.query(insert('note', { entity: 3, text: 'Pruning' }))
db.query(insert('owner0', { entity: 6, person: 1 }))
let entity = and(
  ...[
    '',
    'link.parent.',
    'link.parent.link.parent.',
    'via.parent.',
    'via.parent.link.parent.',
  ].flatMap((at) =>
    owners.map((name) =>
      or(absent(`${at}${name}`), eq(`${at}${name}.person`, 'reader'))
    )
  ),
)
let extension = search(fields(vocab), db)
let read = (q: string) =>
  db.query(compile(parse(q), vocab, {
    visibility: { entity, components: { doc: '.entity.eid!=private' } },
    extend: [extension],
  })).map((r) => r.eid)
read('Pruning .limit=1')
read('Pruning .order=search')
test('ranked ownership searches fit engine limits and keep hidden owners and text out of the page', () => {
  equal(read('Pruning .limit=1'), ['seen'])
  equal(read('Pruning .order=search'), ['seen'])
})
