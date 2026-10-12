// Reading one text for embedding must not resolve it again just to decide
// whether it is blank. A resolver can seek another table for every evaluation.
import '../sqlite/sqlitepath.ts'
import { Database } from '@db/sqlite'
import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { type Expr, fn } from '@yaks/sql'
import { statements } from '@yaks/sqlite'
import { driver } from '../sqlite/native.ts'
import { fields } from './fields.ts'
import { sources } from './sweep.ts'
import { shelf, shop } from './testing.ts'

let native = new Database(':memory:')
let db = shelf(statements(driver(native)))
let reads = 0
native.function('resolved_text', (text: string | null) => {
  reads++
  return text
})
let text = fields(shop).map((f) => ({
  ...f,
  text: (stored: Expr) => fn('resolved_text', stored),
}))

sources(db, text, [1])
reads = 0

test('assembling an entity resolves each of its text fields once', () => {
  reads = 0
  assertEquals(sources(db, text, [1]), [{
    owner: 1,
    entity: 'book-1',
    text: 'The Hobbit\nA burglar leaves home and meets a dragon.',
    had: null,
  }])
  assertEquals(reads, 2)
})
