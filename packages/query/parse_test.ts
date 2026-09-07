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
  ensure,
  eq,
  every,
  fields,
  gate,
  ge,
  gt,
  hasRefs,
  le,
  limit,
  list,
  lt,
  mutable,
  ne,
  near,
  never,
  order,
  parse,
  present,
  range,
  reaches,
  refs,
  resource,
  scalar,
  tally,
  text,
  variable,
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
  // presence and absence: the sigil spellings, and the older ones they replace
  ['.assignee', and(present('assignee'))],
  ['!assignee', and(absent('assignee'))],
  ['.assignee!', and(present('assignee'))],
  ['.assignee=', and(absent('assignee'))],
  ['!.assignee', and(absent('assignee'))],
  ['.created.at', and(present('created.at'))],
  // the rule sigils
  ['+created', and(ensure('created'))],
  ['+!created', and(gate('created'))],
  ['*created', and(mutable('created'))],
  // a resource is capitalized: it binds beside the components, not among them
  ['#Clock', and(resource('Clock'))],
  ['$e', and(variable('e'))],
  ['.entity,+!created', and(present('entity'), gate('created'))],
  ['.entity, +!created', and(present('entity'), gate('created'))],
  // `,` between clauses is AND; inside a value it stays any-of
  [
    '.status=open,.priority<=1&*task',
    and(
      eq('status', list('open', '.priority<=1')),
      mutable('task'),
    ),
  ],
  ['.task,.doc', and(present('task'), present('doc'))],
  // the dot is accepted, never required, once a token carries an operator
  ['status=open', and(eq('status', 'open'))],
  ['comment.target=T-3', and(eq('comment.target', 'T-3'))],
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

// A dot-marked word is the component, present; the same word bare is searched
// for. Quotes make a text term of anything, operators included.
Deno.test('the dot tells a component from a word', () => {
  assertEquals(parse('.env'), and(present('env')))
  assertEquals(parse('env'), and(text('env')))
  assertEquals(parse('"comp.prop=1"'), and(text('comp.prop=1')))
})

// A comma announces another clause, so a bare word beside one is the component
// it names — the rest of the line stays search terms.
Deno.test('a comma puts a word in query position', () => {
  assertEquals(
    parse('!foo, bar hello there'),
    and(absent('foo'), present('bar'), text('hello'), text('there')),
  )
})

// `text: false` — a rule, or a saved filter, takes no bare-word search terms.
Deno.test('text: false refuses a bare word', () => {
  assertEquals(
    parse('.doc, *task', { text: false }),
    and(
      present('doc'),
      mutable('task'),
    ),
  )
  assertThrows(() => parse('.doc hello', { text: false }), Error, 'not words')
  // quoting is how a strict query still asks for a word
  assertEquals(parse('"hello"', { text: false }), and(text('hello')))
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
