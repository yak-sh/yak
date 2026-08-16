// The Edit primitive's pure half: a surgical replacement builds the guarded
// patch, and every ambiguous or empty case refuses rather than clobber.
import { editChanges } from './edit.ts'
import { type Row, rows } from './client.ts'
import { sha } from './sha.ts'
import { assertEquals, assertThrows } from '@std/assert'

let E = 'aaaaaaaa-0000-4000-8000-000000000002'
let doc = (body: string): Row =>
  rows({
    changes: [
      { eid: E, name: 'entity', comp: { eid: E, num: 2 } },
      { eid: E, name: 'doc', comp: { title: 'Doc', body } },
    ],
  })[0]

Deno.test('editChanges: surgical replace, guarded by the body read', () => {
  // A single replacement, guarded with the SHA of the body it read.
  let body = 'fix teh plan, teh whole plan'
  let [c] = editChanges(doc(body), 'teh plan', 'the plan')
  assertEquals(c.comp, { body: 'fix the plan, teh whole plan' })
  assertEquals(c.was, { body: sha(body) }) // the compare-and-swap token

  // Deleting the match: an empty replacement.
  assertEquals(
    editChanges(doc('a typo here'), 'typo ', '')[0].comp,
    { body: 'a here' },
  )

  // A non-unique match is refused — unless replace_all takes them all.
  assertThrows(
    () => editChanges(doc('teh teh'), 'teh', 'the'),
    Error,
    '2 matches',
  )
  assertEquals(
    editChanges(doc('teh teh'), 'teh', 'the', true)[0].comp,
    { body: 'the the' },
  )

  // A missing match, an empty old, an unchanged result, and a body-less
  // entity each refuse rather than write nothing or clobber.
  assertThrows(() => editChanges(doc('abc'), 'xyz', 'q'), Error, 'not found')
  assertThrows(() => editChanges(doc('abc'), '', 'q'), Error, 'empty')
  assertThrows(() => editChanges(doc('abc'), 'abc', 'abc'), Error, 'unchanged')
  let bare = rows({
    changes: [{ eid: E, name: 'entity', comp: { eid: E, num: 2 } }],
  })[0]
  assertThrows(() => editChanges(bare, 'a', 'b'), Error, 'no doc body')
})
