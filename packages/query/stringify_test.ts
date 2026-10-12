// AST -> text: whatever `stringify` writes, `parse` reads back to the same tree.

import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { and, contains, eq, list, parse, scalar, stringify } from './mod.ts'

let back = (q: string) => assertEquals(parse(stringify(parse(q))), parse(q), q)

test('a parsed query is written back to the same tree', () =>
  [
    '.a=1 .b=2|.c=3',
    '.a=1&(.b=2|.c=3&.d=4)',
    '.a|(.b|.c)',
    '.a|.refs=T-1',
    '.c (.a|.b&.order=hot) *',
    '.comments!.reviews!.stars=5',
    '.comments!.status=done',
    '.comments.reviews!.stars=5',
    '.reviews!.flagged',
    '.doc hello',
    '.doc, *task',
    '.edges.limit=12',
    '.edges[a,b]',
    '.edges[referenced, entry.session]',
    '.edges.peers=status,title',
    '.edges',
    '.env !refs .refs .count',
    '.priority=1..5,10..20',
    '.at=1...5',
    '.requires[<=3]->T-1',
    '.requires<-T-1',
    '.p<-1',
    '.s&(.a=1,2|.b=3)',
    '.status=open .priority<=1',
    '.task.status=open&.order=hot&.near=T-3&.limit=50&.after=900',
    '.after=0b5a3d6c-6f1e-4a43-9a5e-1c2d3e4f5a6b',
    '.title~="say \\"hi\\""',
    '.title~="two words"',
    '.title~="a,b..c"',
    '.web.url="https://x/p?a=1&b=2"',
    '.doc.title="(paren"',
    '.doc.title="jeff\'s"',
    '*trashed, !trashed.at, #Actor',
    '!foo, bar hello there',
    '"two words"',
    '"comp.prop=1"',
    '"*"',
    '"(x"',
    '"a,b"',
    '?doc -gone +!gate #0b5a3d6c +doc +doc.title=$x *note.body=hi',
    '$x $y=5',
    '.distinct=filed.domain',
    '.tally=task.status',
    '.fields=pin.x,pin.z~',
    '.drill!',
    '',
    'env',
    'open',
  ].forEach(back))

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

test('a value the grammar cannot say throws rather than say another', () => {
  for (let v of ['a,b', '1..5']) {
    assertThrows(() => stringify(and(eq('doc.title', v))), SyntaxError)
  }
  assertThrows(() => stringify(contains('t', list('a', 'b'))), SyntaxError)
  assertEquals(
    parse(stringify(and(contains('doc.title', scalar('a,b..c'))))),
    parse('.doc.title~="a,b..c"'),
  )
})
