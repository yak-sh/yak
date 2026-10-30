// Excerpts stay bounded even when an indexed row is a transcript or raw artifact.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { insert } from '@yaks/sql'
import { find } from './search.ts'
import { fields } from './fields.ts'
import { CLOSE, OPEN } from './term.ts'
import { entity, shelf, shop, stashed } from './testing.ts'

let db = shelf(), text = fields(shop)
let prose = 'padding '.repeat(10_000)
for (
  let [id, title, blurb] of [
    [
      5,
      'Large transcript',
      `${prose}Namespace docs check README type check doc-only fails Deno namespace ${prose}`,
    ],
    [6, 'Unicode transcript', `${prose}𝓐lpha Café Über ${prose}`],
    [7, 'Late transcript', `${'padding '.repeat(150_000)} lateword`],
  ] as const
) {
  entity(db, id, `book-${id}`)
  db.query(insert('book', { entity: id, title, blurb, price: 1 }))
}
let away = shelf(stashed)

// Preparation is outside the timed cases, including each ranking statement.
find(db, text, 'namespace docs check README type check doc-only fails Deno')
find(db, text, '𝓐lpha')
find(db, text, 'lateword')

test('a large hit keeps its rank and a bounded term-centered marked excerpt', () => {
  let [hit] = find(
    db,
    text,
    'namespace docs check README type check doc-only fails Deno',
  )
  assertEquals(hit.entity, 'book-5')
  assert(hit.snippet.includes(`${OPEN}namespace${CLOSE}`))
  assert(hit.snippet.length < 200)
})
test('supplementary characters do not split the highlighted phrase', () => {
  let [hit] = find(db, text, '𝓐lpha')
  assert(hit.snippet.includes(`${OPEN}𝓐lpha${CLOSE}`), hit.snippet)
})
test('a diacritic-folded match and a match past the preview still return bounded text', () => {
  for (let words of ['cafe', 'lateword']) {
    let [hit] = find(db, text, words)
    assert(hit.snippet.length > 0 && hit.snippet.length < 200)
    assert(!hit.snippet.includes(`${OPEN}${CLOSE}`))
  }
})
test('external-content excerpts read through the declared resolved text source', () => {
  assert(
    find(away, text, 'burglar')[0].snippet.includes(`${OPEN}burglar${CLOSE}`),
  )
})
