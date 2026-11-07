// AST -> text: whatever `stringify` writes, `parse` reads back to the same tree.

import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import {
  and,
  contains,
  eq,
  list,
  listed,
  parse,
  range,
  scalar,
  stringify,
} from './mod.ts'

let back = (q: string) => assertEquals(parse(stringify(parse(q))), parse(q), q)

let roundTrips = (name: string, queries: string[]) =>
  test(`a parsed ${name} is written back to the same tree`, () =>
    queries.forEach(back))

roundTrips('boolean query', [
  '.a=1 .b=2|.c=3',
  '.a=1&(.b=2|.c=3&.d=4)',
  '.a|(.b|.c)',
  '.a|.refs=T-1',
  '.c (.a|.b&.order=hot) *',
  '.s&(.a=1,2|.b=3)',
])

roundTrips('range and bare-word query', [
  '.status=open .priority<=1',
  '.priority=1..5,10..20',
  '.at=1...5',
  '',
  'env',
  'open',
])

roundTrips('walk query', [
  '.comments!.reviews!.stars=5',
  '.comments!.status=done',
  '.comments.reviews!.stars=5',
  '.reviews!.flagged',
  '.requires[<=3]->T-1',
  '.requires<-T-1',
  '.p<-1',
])

roundTrips('directive query', [
  '.task.status=open&.order=hot&.near=T-3&.limit=50&.after=900',
  '.after=0b5a3d6c-6f1e-4a43-9a5e-1c2d3e4f5a6b',
  '.distinct=filed.domain',
  '.tally=task.status',
  '.fields=pin.x,pin.z~',
  '.drill!',
  '.env !refs .refs .count',
])

roundTrips('quoted-value query', [
  '.title~="say \\"hi\\""',
  '.title~="two words"',
  '.title~="a,b..c"',
  '.web.url="https://x/p?a=1&b=2"',
  '.doc.title="(paren"',
  '.doc.title="jeff\'s"',
])

roundTrips('text and quoted-term query', [
  '.doc hello',
  '.doc, *task',
  '*trashed, !trashed.at, #Actor',
  '!foo, bar hello there',
  '"two words"',
  '"comp.prop=1"',
  '"*"',
  '"?*"',
  '"(x"',
  '"a,b"',
])

roundTrips('variable and projection query', [
  '?doc -gone +!gate #0b5a3d6c +doc +doc.title=$x *note.body=hi',
  '$x $y=5',
])

test('a built tree is written in the grammar', () => {
  assertEquals(
    stringify(
      and(eq('doc.title', 'Two words'), eq('entity.eid', list('a', 'b'))),
    ),
    '.doc.title="Two words"&.entity.eid=a,b',
  )
  let spaced = and(eq('tags', list('a b', 'c', 'd e')))
  assertEquals(parse(stringify(spaced)), spaced)
  assertEquals(stringify('.left as=is'), '.left as=is')
})

test('a literal comma or range marker is written quoted', () => {
  for (let v of ['a,b', '1..5', 'Hi, there.']) {
    let q = and(eq('doc.title', v))
    assertEquals(parse(stringify(q)), q)
  }
  let quotedList = and(eq('tag', list('a, b', 'c', range('1', '5'))))
  assertEquals(stringify(quotedList), '.tag="a, b",c,1..5')
  assertEquals(parse(stringify(quotedList)), quotedList)
})

test('a range end that reads as structure is quoted on its own', () => {
  let ends: [string, string][] = [
    ['30s ago', 'now'],
    ['a b', 'c d'],
    ['a,b', 'c..d'],
    ['-5', '5.'],
    ['x&y', "it's"],
  ]
  for (let [lo, hi] of ends) {
    for (let q of [eq('t', range(lo, hi)), eq('t', range(lo, hi, true))]) {
      assertEquals(parse(stringify(and(q))), and(q), `${lo}..${hi}`)
    }
  }
  assertEquals(
    stringify(and(eq('t', range('30s ago', 'now')))),
    '.t="30s ago"..now',
  )
})

test('listed writes values as one any-of value, each quoted as it needs', () => {
  let values = ['a', 'Hi, there.', 'two words', '1..5', 'x&y']
  assertEquals(listed(values), 'a,"Hi, there.","two words","1..5","x&y"')
  assertEquals(parse(`.t=${listed(values)}`), and(eq('t', list(...values))))
  assertEquals(parse(`.t=${listed(['only, one'])}`), and(eq('t', 'only, one')))
  assertEquals(listed([]), '')
})

test('a value the grammar cannot say throws rather than say another', () => {
  assertThrows(() => stringify(contains('t', list('a', 'b'))), SyntaxError)
  assertEquals(
    parse(stringify(and(contains('doc.title', scalar('a,b..c'))))),
    parse('.doc.title~="a,b..c"'),
  )
})
