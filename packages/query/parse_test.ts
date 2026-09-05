// Format -> AST, across every operator and literal form, and the equivalence
// that defines the boundary: a parsed string equals the builder calls for it.
// No schema, no vocabulary, no storage appears anywhere here — if a case needed
// one, the design leaked coupling.

import { assertEquals, assertThrows } from '@std/assert'
import {
  absent,
  after,
  and,
  contains,
  count,
  distinct,
  edges,
  eq,
  every,
  fields,
  ge,
  gt,
  hasRefs,
  le,
  limit,
  list,
  lt,
  ne,
  near,
  never,
  order,
  parse,
  present,
  range,
  reaches,
  refs,
  scalar,
  tally,
  text,
  want,
} from './mod.ts'

// Each row: a query string, and the builder AST it must parse to.
let cases: [string, ReturnType<typeof and>][] = [
  ['.status=open', and(eq('status', 'open'))],
  ['.priority<=1', and(le('priority', '1'))],
  ['.priority<1', and(lt('priority', '1'))],
  ['.priority>=2', and(ge('priority', '2'))],
  ['.priority>2', and(gt('priority', '2'))],
  ['.status!=done', and(ne('status', 'done'))],
  ['.title~=word', and(contains('title', 'word'))],
  ['.domain=Ops,Eng', and(eq('domain', list('Ops', 'Eng')))],
  ['.priority=1..5', and(eq('priority', range('1', '5')))],
  ['.priority=1...5', and(eq('priority', range('1', '5', true)))],
  ['.created.at=2026-07-25', and(eq('created.at', scalar('2026-07-25')))],
  ['.assignee!', and(present('assignee'))],
  ['.assignee=', and(absent('assignee'))],
  ['.loan?', and(want('loan'))],
  [
    '.comment.target.doc.title~=foo',
    and(contains('comment.target.doc.title', 'foo')),
  ],
  ['.pin.x=12', and(eq('pin.x', '12'))],
  // rankings and directives
  ['.order=hot', and(order('hot'))],
  ['.near=T-3', and(near('T-3'))],
  ['.refs=T-3', and(refs('T-3'))],
  ['.refs=', and(refs(''))],
  ['.refs!', and(hasRefs())],
  ['.count!', and(count())],
  ['.distinct=domain', and(distinct('domain'))],
  ['.tally=task.domain', and(tally('task.domain'))],
  ['.fields=pin.x,pin.z~', and(fields('pin.x', 'pin.z~'))],
  // `*` is the widest projection, and only as a whole token: a trailing star
  // on a word stays the full-text prefix term.
  ['*', and(every())],
  ['.recipe!&*', and(present('recipe'), every())],
  ['lemo*', and(text('lemo*'))],
  ['.limit=200', and(limit(200))],
  ['.after=13882', and(after(13882))],
  ['.edges!', and(edges())],
  [
    '.edges.peers=status,title',
    and(edges({ peers: [['status'], ['title']] })),
  ],
  [
    '.edges[referenced,entry.session]!',
    and(edges({ select: { type: 'referenced', via: ['entry', 'session'] } })),
  ],
  ['.reaches[requires,<=3]=T-42', and(reaches('requires', 3, 'T-42'))],
  // text terms, and a search-style mix
  ['runner', and(text('runner'))],
  ['runner exit', and(text('runner'), text('exit'))],
  ['runner .status=done', and(text('runner'), eq('status', 'done'))],
  // separators: & and whitespace both mean AND
  ['.status=open&.priority<=1', and(eq('status', 'open'), le('priority', '1'))],
  ['.status=open .priority<=1', and(eq('status', 'open'), le('priority', '1'))],
]

for (let [q, want] of cases) {
  Deno.test(`parse ${q}`, () => assertEquals(parse(q), want))
}

// The empty query selects nothing.
Deno.test('empty query is never', () => {
  assertEquals(parse(''), and(never()))
  assertEquals(parse('   '), and(never()))
})

// A quoted value glues across '&' and whitespace into one predicate.
Deno.test('quotes glue a value across & and spaces', () => {
  assertEquals(
    parse('.web.url="https://x/p?a=1&b=2"'),
    and(eq('web.url', 'https://x/p?a=1&b=2')),
  )
  assertEquals(parse('.title~=two words'), and(contains('title', 'two words')))
})

// A quoted bare word stays one phrase text term.
Deno.test('quoted phrase is one text term', () => {
  assertEquals(parse('"two words"'), and(text('two words')))
})

// An opless dot-word is a text term, not a filter.
Deno.test('opless dot-word is a text term', () => {
  assertEquals(parse('.env'), and(text('.env')))
})

// A list of ranges, one value.
Deno.test('list of ranges', () => {
  assertEquals(
    parse('.priority=1..5,10..20'),
    and(eq('priority', list(range('1', '5'), range('10', '20')))),
  )
})

// Malformed or ambiguous forms are refused at the format layer.
Deno.test('refusals', () => {
  assertThrows(() => parse('.limit=abc'), Error, 'whole number')
  assertThrows(() => parse('.reaches[requires,<=0]=X'), Error, 'at least one')
  assertThrows(() => parse('.distinct='), Error, 'names a column')
  assertThrows(() => parse('.refs<3'), Error, '.refs')
  // Two presence filters mashed together — a forgotten '&'.
  assertThrows(() => parse('.assignee!.status=done'), Error, 'join filters')
})

// A reserved word without its bracket is just a raw path here — validating it
// is schema. `.reaches=X` is an ordinary predicate, not a traversal.
Deno.test('bracketless reserved word is a plain predicate', () => {
  assertEquals(parse('.reaches=X'), and(eq('reaches', 'X')))
})
