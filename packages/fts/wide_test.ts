// A search over more indexes than one compound SELECT may carry: workerd, the
// SQLite under a yaks.app store, refuses a sixth term, and a store whose
// vocabulary searches seven components still answers every search.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { bounded } from '../sqlite/testing.ts'
import { fields, schema, search } from './mod.ts'

let kinds = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
let vocab = loadVocab({
  $defs: Object.fromEntries(kinds.map((k) => [k, {
    component: true,
    type: 'object',
    properties: { prose: { type: 'string', search: true } },
  }])),
})

let db = bounded({ compoundSelect: 5 })
let text = fields(vocab)
let store = storage(db, vocab, { extend: [search(text, db)] })
store.install()
for (let stmt of schema(text)) db.query(stmt)
store.tx((tx) =>
  tx.patch(kinds.flatMap((k, i) => [
    {
      entity: { eid: `${k}1` },
      [k]: { prose: `ceramic mug ${'glaze '.repeat(i)}` },
    },
    { entity: { eid: `${k}2` }, [k]: { prose: 'woven basket' } },
  ]))
)
let found = (line: string) => store.read(line).map((b) => b.entity.eid)
let mugs = kinds.map((k) => `${k}1`)

test('a search over seven indexes answers within five compound terms', () => {
  assertEquals(found('ceramic').sort(), mugs)
  assertEquals(found('ceramic .order=search'), mugs)
  assertEquals(found('ceramic .limit=3'), mugs.slice(0, 3))
  assertEquals(found('ceramic mug .limit=20'), mugs)
  assertEquals(found('"woven basket" .limit=2').length, 2)
})
