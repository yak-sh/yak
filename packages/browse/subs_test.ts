// The agreement seam, proven without a socket: which queries a subscription
// is expected to disagree with a scan on, and the diff between the two.
import { test } from '@yaks/testing'
import './testing.ts'
import { assertEquals } from '@std/assert'
import { parseQuery } from './query.ts'
import { diff, gaps } from './subs.ts'

let cases = ([
  ['.task.status=open', []],
  ['.filed.domain=Ops,Eng', []],
  ['.filed.priority=1..3', []],
  ['.task.status!=done', []],
  ['.doc.title~=flux', []],
  ['.created.at=2026-07-01', []],
  ['.order=hot', []],
  ['.filed.assignee.doc.title~=jeff', []],
  ['.updated.at=today', ['moving-time']],
  ['.updated.at>="1 hour ago"', ['moving-time']],
] as [string, string[]][]).map(([q, want]) => ({
  q,
  preds: parseQuery(q),
  want,
}))

test('the only agreement gap is moving time', () => {
  for (let { q, preds, want } of cases) assertEquals(gaps(preds), want, q)
})

test('agreement diff names both sides once and in order', () => {
  assertEquals(diff(['c', 'a', 'c'], ['b', 'c']), {
    scanOnly: ['a'],
    subOnly: ['b'],
  })
})
