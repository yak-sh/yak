// A bare column, read off the line it sits on. The graph-wide effect (a
// `/query` line saying `.task&.status=open`) rides on `graph.read`; this is
// the pure half.

import { assert, assertEquals, assertThrows } from '@std/assert'
import { Ambiguous, loadVocab } from '@yaks/vocab'
import { parse } from '@yaks/query'
import { meaning } from './meant.ts'

// Two components claiming `status`, as a graph keeping both work and
// transcripts does, plus one word only the task has.
let vocab = loadVocab([{
  $defs: {
    entity: { component: true, wire: false, properties: {} },
    doc: {
      component: true,
      kind: true,
      properties: { title: { type: 'string' } },
    },
    task: {
      component: true,
      kind: true,
      properties: {
        status: { type: 'string', enum: ['open', 'done'] },
        domain: { type: 'string' },
      },
    },
    session: {
      component: true,
      kind: true,
      properties: { status: { type: 'string', enum: ['running', 'settled'] } },
    },
  },
}])

let mean = meaning(vocab)
let said = (q: string) => mean(q)

Deno.test('the comp the line selects resolves the bare column', () => {
  assertEquals(said('.task&.status=open'), parse('.task&.task.status=open'))
  assertEquals(
    said('.session&.status=running'),
    parse('.session&.session.status=running'),
  )
})

Deno.test('a qualified path selects its comp for the rest of the line', () => {
  assertEquals(
    said('.task.domain=Ops&.status=open'),
    parse('.task.domain=Ops&.task.status=open'),
  )
})

Deno.test('nothing on the line picking one leaves the refusal standing', () => {
  assertEquals(said('.status=open'), '.status=open')
  let e = assertThrows(() => vocab.route('status'), Ambiguous)
  assertEquals((e as Ambiguous).comps, ['session', 'task'])
})

Deno.test('a line naming both candidates is still ambiguous', () => {
  assertEquals(
    said('.task&.session&.status=open'),
    '.task&.session&.status=open',
  )
})

Deno.test('a line naming no bare column comes back whole', () => {
  assertEquals(said('.task.status=open&.limit=3'), '.task.status=open&.limit=3')
  assertEquals(said('.doc.title=Dune'), '.doc.title=Dune')
  assertEquals(said('.task&.domain=Ops'), '.task&.domain=Ops')
})

Deno.test('an alternative reads its own arm, never its neighbour', () => {
  assertEquals(
    said('.task&.status=open|.session&.status=running'),
    parse('.task&.task.status=open|.session&.session.status=running'),
  )
  // The bare word sits in an arm that names nobody, so it stays refused.
  assertEquals(
    said('.task&.domain=Ops|.status=open'),
    '.task&.domain=Ops|.status=open',
  )
})

Deno.test('an aggregate, a projection and an ordering name columns too', () => {
  assertEquals(said('.task&.tally=status'), parse('.task&.tally=task.status'))
  assertEquals(
    said('.task&.distinct=status'),
    parse('.task&.distinct=task.status'),
  )
  assertEquals(said('.task&.fields=status'), parse('.task&.fields=task.status'))
  assertEquals(said('.task&.order=-status'), parse('.task&.order=-task.status'))
})

Deno.test('a ranking and an unknown word are left for whoever owns them', () => {
  assertEquals(said('.task&.order=similar'), '.task&.order=similar')
  assertEquals(said('.task&.hot=1'), '.task&.hot=1')
})

Deno.test('an already-built AST is read the same way', () => {
  let ast = parse('.task&.status=open')
  let out = mean(ast)
  assert(out != ast)
  assertEquals(out, parse('.task&.task.status=open'))
})
