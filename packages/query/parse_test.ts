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
  refs,
  resource,
  scalar,
  tally,
  text,
  variable,
  walk,
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
  // a quoted member may hold what a bare one cannot
  ['.tag="a b",c', and(eq('tag', list('a b', 'c')))],
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
  ['.entity +!created', and(present('entity'), gate('created'))],
  // `?comp` is the prefix mirror of `!comp`; `.comp?` stays its synonym
  ['?doc', and(want('doc'))],
  ['!doc ?former', and(absent('doc'), want('former'))],
  [
    '.task !doc ?former .status=open',
    and(
      present('task'),
      absent('doc'),
      want('former'),
      eq('status', 'open'),
    ),
  ],
  // `,` between clauses is optional; inside a value it stays any-of
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
  // a hyphen inside a word is a letter; `<` before a negative number stays a
  // comparison, never a walk
  ['.blocked-by=T-1', and(eq('blocked-by', 'T-1'))],
  ['.priority<-1', and(lt('priority', '-1'))],
  ['.x<-1.5', and(lt('x', '-1.5'))],
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
  // the bracket on `edges` is the select, read as two bare qualifiers
  [
    '.edges[referenced,entry.session]!',
    and(edges({ select: { type: 'referenced', via: ['entry', 'session'] } })),
  ],
  ['.edges[cites]', and(edges({ select: { type: 'cites' } }))],
  // the walk: a path, its optional cap, an arrow, one entity
  ['.requires->T-42', and(walk('requires', '->', 'T-42'))],
  ['.requires<-T-42', and(walk('requires', '<-', 'T-42'))],
  ['.requires[<=3]->T-42', and(walk('requires', '->', 'T-42', 3))],
  ['.fork.from[<=2]<-S-7', and(walk('fork.from', '<-', 'S-7', 2))],
  ['requires->T-42', and(walk('requires', '->', 'T-42'))],
  ['.requires<-3fa85f64-5717', and(walk('requires', '<-', '3fa85f64-5717'))],
  // text terms, and a search-style mix
  ['runner', and(text('runner'))],
  ['runner exit', and(text('runner'), text('exit'))],
  ['runner .status=done', and(text('runner'), eq('status', 'done'))],
  // separators: & and whitespace both mean AND
  ['.status=open&.priority<=1', and(eq('status', 'open'), le('priority', '1'))],
  ['.status=open .priority<=1', and(eq('status', 'open'), le('priority', '1'))],
  [
    '.requires[<=2]->T-1&.status=open',
    and(walk('requires', '->', 'T-1', 2), eq('status', 'open')),
  ],
  [
    '.edges[cites,author]!,.post',
    and(edges({ select: { type: 'cites', via: ['author'] } }), present('post')),
  ],
  // a bracket after the operator is part of the value
  ['.title~=x[1]', and(contains('title', 'x[1]'))],
  ['.tag=a[1],b', and(eq('tag', list('a[1]', 'b')))],
]

for (let [q, want] of cases) {
  Deno.test(`parse ${q}`, () => assertEquals(parse(q), want))
}

// Every term stands alone: a pasted line parses to the same thing whether the
// terms arrive together or one at a time (the shell-pasting property).
Deno.test('each term stands alone', () => {
  let line = '.requires[<=3]->T-42 .status=open ?doc *task !done runner'
  assertEquals(
    parse(line),
    and(...line.split(' ').flatMap((t) => parse(t).clauses)),
  )
})

// The empty query selects nothing.
Deno.test('empty query is never', () => {
  assertEquals(parse(''), and(never()))
  assertEquals(parse('   '), and(never()))
})

// A quoted value glues across '&' and whitespace into one predicate; unquoted,
// whitespace ends the value and the rest is the next term.
Deno.test('quotes glue a value across & and spaces', () => {
  assertEquals(
    parse('.web.url="https://x/p?a=1&b=2"'),
    and(eq('web.url', 'https://x/p?a=1&b=2')),
  )
  assertEquals(
    parse('.title~="two words"'),
    and(contains('title', 'two words')),
  )
  assertEquals(parse(".status='open wip'"), and(eq('status', 'open wip')))
  assertEquals(
    parse('.title~=two words'),
    and(contains('title', 'two'), text('words')),
  )
  // a backslash escapes inside quotes
  assertEquals(
    parse('.title~="say \\"hi\\""'),
    and(contains('title', 'say "hi"')),
  )
  assertThrows(() => parse('.title~="open'), Error, 'unclosed quote')
})

// A quoted bare word stays one phrase text term; an apostrophe inside a word
// opens nothing.
Deno.test('quoted phrase is one text term', () => {
  assertEquals(parse('"two words"'), and(text('two words')))
  assertEquals(parse("'two words'"), and(text('two words')))
  assertEquals(parse("jeff's"), and(text("jeff's")))
})

// A list is one token: a space beside its comma, or an empty member, is refused
// rather than read as the caller's most likely meaning.
Deno.test('a list has no spaces and no empty member', () => {
  assertThrows(() => parse('.status=open, wip'), Error, 'no spaces')
  assertThrows(() => parse('.status=open ,wip'), Error, 'no spaces')
  assertThrows(() => parse('.status=open,'), Error, 'no spaces')
  assertThrows(() => parse('.status=open,,wip'), Error, 'no spaces')
  // with a clause on the far side, the comma is the optional separator
  assertEquals(
    parse('.status=open, .p=1'),
    and(eq('status', 'open'), eq('p', '1')),
  )
  assertEquals(
    parse('*trashed, trashed.at=, #Actor'),
    and(mutable('trashed'), absent('trashed.at'), resource('Actor')),
  )
})

// A bare word is one thing wherever it stands: a search term. The component it
// might name is the dot-marked spelling.
Deno.test('a comma between clauses means nothing', () => {
  assertEquals(
    parse('!foo, bar hello there'),
    and(absent('foo'), text('bar'), text('hello'), text('there')),
  )
  assertEquals(parse('!foo, .bar'), and(absent('foo'), present('bar')))
})

// A dot-marked word is the component, present; the same word bare is searched
// for. Quotes make a text term of anything, operators included.
Deno.test('the dot tells a component from a word', () => {
  assertEquals(parse('.env'), and(present('env')))
  assertEquals(parse('env'), and(text('env')))
  assertEquals(parse('"comp.prop=1"'), and(text('comp.prop=1')))
})

// `text: false` — a rule, or a saved filter, takes no bare-word search terms.
Deno.test('text: false refuses a bare word', () => {
  assertEquals(
    parse('.doc, *task', { text: false }),
    and(present('doc'), mutable('task')),
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

// The bracket binds to the path and each clause says what it accepts: the
// walk takes one depth cap, nothing else takes any — an unknown qualifier is
// refused by name, never dropped.
Deno.test('qualifiers', () => {
  assertThrows(() => parse('.status[<=3]=open'), Error, 'no qualifier')
  assertThrows(() => parse('.doc[x]'), Error, 'no qualifier')
  assertThrows(() => parse('.order[k=v]=hot'), Error, 'no qualifier')
  assertThrows(() => parse('.requires[<=0]->X'), Error, 'at least one')
  assertThrows(() => parse('.requires[<=]->X'), Error, 'one depth cap')
  assertThrows(() => parse('.requires[3]->X'), Error, 'one depth cap')
  assertThrows(() => parse('.requires[<=3,<=4]->X'), Error, 'one depth cap')
  assertThrows(() => parse('.requires[]->X'), Error, 'empty qualifier')
  assertThrows(() => parse('.requires[<=3->X'), Error, 'unclosed bracket')
  assertThrows(() => parse('.requires->'), Error, 'one entity')
  assertThrows(() => parse('.requires->a,b'), Error, 'one entity')
  assertThrows(() => parse('.edges[a,b,c]!'), Error, 'one edge type')
  assertThrows(() => parse('.edges[<=3]!'), Error, 'one edge type')
  // whitespace inside the bracket is the bracket's own
  assertEquals(
    parse('.edges[referenced, entry.session]!'),
    and(edges({ select: { type: 'referenced', via: ['entry', 'session'] } })),
  )
  assertEquals(
    parse('.requires[ <= 3 ]->T-1'),
    and(walk('requires', '->', 'T-1', 3)),
  )
})

// Malformed or ambiguous forms are refused at the format layer.
Deno.test('refusals', () => {
  assertThrows(() => parse('.limit=abc'), Error, 'whole number')
  assertThrows(() => parse('.distinct='), Error, 'names a column')
  assertThrows(() => parse('.refs<3'), Error, '.refs')
  // Two presence filters mashed together — a forgotten space.
  assertThrows(() => parse('.assignee!.status=done'), Error, 'separate filters')
  // the removed spelling of the walk: its bracket is an unknown qualifier
  assertThrows(
    () => parse('.reaches[requires,<=3]=T-42'),
    Error,
    'no qualifier',
  )
  assertThrows(() => parse('?doc[x]'), Error, 'not a clause')
  assertThrows(() => parse('.doc[x]?'), Error, 'no qualifier')
})

// A reserved word without its bracket is just a raw path here — validating it
// is schema. `.reaches=X` is an ordinary predicate, not a traversal.
Deno.test('bracketless reserved word is a plain predicate', () => {
  assertEquals(parse('.reaches=X'), and(eq('reaches', 'X')))
})
