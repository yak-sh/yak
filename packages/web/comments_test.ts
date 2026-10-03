// Thread grouping preserves independent branches, nesting and every word.
import { test } from '@yaks/testing'
import './testing.ts'
import { assertEquals } from '@std/assert'
import type { Ent } from './types.ts'
import { type Branch, branches } from './comments.ts'

let note = (
  eid: string,
  num: number,
  reply_to?: string,
  target = 'task',
): Ent => ({
  eid,
  num,
  kind: 'comment',
  refs: [],
  kids: [],
  comment: { eid, target, reply_to },
})
let shape = (nodes: Branch[]): unknown[] =>
  nodes.map(({ row, children }) => [row.eid, shape(children)])

test('replies nest under the answered comment, unrelated comments stay roots', () => {
  assertEquals(
    shape(branches([
      note('answer', 4, 'ask'),
      note('other', 2),
      note('ask', 1),
      note('followup', 5, 'answer'),
      note('alternative', 6, 'ask'),
    ])),
    [
      ['ask', [['answer', [['followup', []]]], ['alternative', []]]],
      ['other', []],
    ],
  )
})

test('missing parents, other threads and cycles cannot hide comments', () => {
  let rows = [
    note('orphan', 1, 'gone'),
    note('elsewhere', 2, undefined, 'other'),
    note('wrong', 3, 'elsewhere'),
    note('self', 4, 'self'),
    note('a', 5, 'b'),
    note('b', 6, 'a'),
    note('leaf', 7, 'b'),
  ]
  assertEquals(shape(branches(rows)), [
    ['orphan', []],
    ['elsewhere', []],
    ['wrong', []],
    ['self', []],
    ['a', [['b', [['leaf', []]]]]],
  ])
})
