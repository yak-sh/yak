// A lexicon admits every word a store's search would match, read off the text
// its indexes are kept from, a body kept elsewhere included.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { admits, joined, lexemes } from './lexicon.ts'
import { sources } from './ddl.ts'
import { fields } from './fields.ts'
import { find } from './search.ts'
import { shelf, shop, stashed } from './testing.ts'

let held = (text = {}) => {
  let db = shelf(text)
  let lexicon = sources(fields(shop), text)
    .flatMap((s) => db.query(s))
    .flatMap((row) => Object.values(row).map(String).flatMap(lexemes))
  return { db, lexicon: joined(lexicon, []) }
}

test('a lexicon admits every search its store answers', () => {
  for (let text of [{}, stashed]) {
    let { db, lexicon } = held(text)
    for (
      let words of ['dragon', 'drag', 'burglar home', 'Hobbit', '"a cook"']
    ) {
      assertEquals(find(db, fields(shop), words).length > 0, true)
      assertEquals(admits(lexicon, words), true, words)
    }
    assertEquals(admits(lexicon, 'wizard'), false)
    assertEquals(admits(lexicon, 'dragon wizard'), false)
  }
})

test('folding is the same on both sides, and coarser than the index', () => {
  let lexicon = joined(lexemes('Ça déborde: ÉCOLE naïve'), [])
  assertEquals(lexicon, ['ca', 'debo', 'ecol', 'naiv'])
  for (let words of ['ça', 'ECOLE', 'école', 'naïve', 'naïve']) {
    assertEquals(admits(lexicon, words), true, words)
  }
})

test('words with no letters ask nothing of a lexicon', () => {
  assertEquals(admits([], '— ...'), true)
  assertEquals(admits([], ''), true)
  assertEquals(admits([], 'a'), false)
})
