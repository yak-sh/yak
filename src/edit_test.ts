// The Edit primitive's pure half: a surgical replacement builds the guarded
// patch, and every ambiguous or empty case refuses rather than clobber. The
// comp-agnostic core `editChange` is what the $edit operator and graph_patch
// both build on; here it is exercised on doc.body directly.
import { editChange, type EditHunk } from './edit.ts'
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
let edit = (row: Row, ...hunks: EditHunk[]) =>
  editChange(row, 'doc', 'body', hunks)

Deno.test('editChange: surgical replace, guarded by the value read', () => {
  // A single replacement, guarded with the SHA of the value it read.
  let body = 'fix teh plan, teh whole plan'
  let c = edit(doc(body), { old: 'teh plan', new: 'the plan' })
  assertEquals(c.comp, { body: 'fix the plan, teh whole plan' })
  assertEquals(c.was, { body: sha(body) }) // the compare-and-swap token

  // Deleting the match: an empty replacement.
  assertEquals(
    edit(doc('a typo here'), { old: 'typo ', new: '' }).comp,
    { body: 'a here' },
  )

  // A non-unique match is refused — unless `all` takes them all.
  assertThrows(
    () => edit(doc('teh teh'), { old: 'teh', new: 'the' }),
    Error,
    '2 matches',
  )
  assertEquals(
    edit(doc('teh teh'), { old: 'teh', new: 'the', all: true }).comp,
    { body: 'the the' },
  )

  // A list of hunks applies in order.
  assertEquals(
    edit(doc('one two three'), { old: 'one', new: '1' }, {
      old: 'three',
      new: '3',
    })
      .comp,
    { body: '1 two 3' },
  )

  // A missing match, an empty old, an unchanged result, and a comp-less
  // entity each refuse rather than write nothing or clobber.
  assertThrows(
    () => edit(doc('abc'), { old: 'xyz', new: 'q' }),
    Error,
    'not found',
  )
  assertThrows(() => edit(doc('abc'), { old: '', new: 'q' }), Error, 'empty')
  assertThrows(
    () => edit(doc('abc'), { old: 'abc', new: 'abc' }),
    Error,
    'unchanged',
  )
  let bare = rows({
    changes: [{ eid: E, name: 'entity', comp: { eid: E, num: 2 } }],
  })[0]
  assertThrows(
    () => editChange(bare, 'doc', 'body', [{ old: 'a', new: 'b' }]),
    Error,
    'no doc component',
  )
})
