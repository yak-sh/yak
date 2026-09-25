// The agreement seam, proven without a socket: which queries a subscription
// is expected to disagree with a scan on, and the diff between the two.
import './testing.ts'
import { assertEquals } from '@std/assert'
import { parseQuery } from './query.ts'
import { diff, gaps } from './subs.ts'

Deno.test('the only agreement gap is moving time', () => {
  let cases: [string, string[]][] = [
    ['.status=open', []],
    ['.domain=Ops,Eng', []],
    ['.priority=1..3', []],
    ['.status!=done', []],
    ['.title~=flux', []],
    ['.created.at=2026-07-01', []],
    ['.order=hot', []],
    ['.assignee.title~=jeff', []],
    ['.updated.at=today', ['moving-time']],
    ['.updated.at>="1 hour ago"', ['moving-time']],
  ]
  for (let [q, want] of cases) assertEquals(gaps(parseQuery(q)), want, q)
})

Deno.test('agreement diff names both sides once and in order', () => {
  assertEquals(diff(['c', 'a', 'c'], ['b', 'c']), {
    scanOnly: ['a'],
    subOnly: ['b'],
  })
})
