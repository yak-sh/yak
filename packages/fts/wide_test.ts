// A search over more indexes than one compound SELECT may carry: workerd, the
// SQLite under a yaks.app store, refuses a sixth term, and a store whose
// vocabulary searches seven components still answers every search.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { bounded } from '../sqlite/testing.ts'
import { fields, find, schema, search } from './mod.ts'

let kinds = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
let vocab = loadVocab({
  $defs: {
    ...Object.fromEntries(kinds.map((k) => [k, {
      component: true,
      type: 'object',
      properties: { prose: { type: 'string', search: true } },
    }])),
    // A word nobody writes, so no table stands for it.
    hidden: { component: true, type: 'object' },
  },
})

let db = bounded({ compoundSelect: 5, variableNumber: 100 })
let text = fields(vocab)
let indexes = schema(text)
let store = storage(db, vocab, {
  extend: [search(text, db)],
  over: () => indexes,
})
store.install()
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

let scope = {
  visibility: {
    entity: kinds.map((k) => `.entity.eid!=${k}2`).join(' ') +
      ' .entity.eid!=a1',
  },
}
test('ranked excerpts share admission scopes within the bound parameter allowance', () => {
  assertEquals(
    find(db, text, 'ceramic', { vocab, scope })
      .map((hit) => hit.entity),
    mugs.slice(1),
  )
})

test('a scope naming a word no table stands for reads it as worn by nobody', () => {
  let scope = { visibility: { entity: '!hidden' } }
  assertEquals(
    find(db, text, 'ceramic', { vocab, scope }).map((hit) => hit.entity).sort(),
    mugs,
  )
})
