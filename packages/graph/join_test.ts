// A rule's match, read: the patterns a source says, the variables they share,
// and the components a batch overlay has to cover for it. What the plan lowers
// to is a storage's business (@yaks/sqlite's rules_test.ts runs it).

import { assertEquals, assertThrows } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { asked, bound, filled, match, reads } from './join.ts'

let vocab = loadVocab([{
  $defs: {
    entity: { component: true, wire: false, properties: {} },
    session: { component: true, properties: {} },
    call: { component: true, properties: {} },
    result: {
      component: true,
      properties: { call: { type: 'string', ref: 'call' } },
    },
    doc: {
      component: true,
      kind: true,
      properties: { title: { type: 'string' } },
    },
  },
}])

Deno.test('a source is patterns, split on the one thing that separates them', () => {
  let m = match('$call .call; .result, result.call=$call')
  assertEquals(m.patterns.length, 2)
  assertEquals(m.patterns[0].entity, 'call')
  assertEquals(m.patterns[1].entity, undefined)
  assertEquals(m.patterns[1].binds, [{
    path: ['result', 'call'],
    name: 'call',
  }])
  assertEquals(m.vars, ['call'])
})

Deno.test('the sigils still say what they always said', () => {
  let m = match('.call, +!result, *result, #Now')
  assertEquals(m.patterns[0].gates, ['result'])
  assertEquals(m.patterns[0].writes, ['result'])
  assertEquals(m.patterns[0].resources, ['Now'])
})

Deno.test('a variable in a value leaves the filter, because a literal $x matches nothing', () => {
  let m = match('.doc.title=$t')
  assertEquals(m.patterns[0].filter.clauses, [])
  assertEquals(m.patterns[0].binds, [{ path: ['doc', 'title'], name: 't' }])
  assertEquals(m.vars, ['t'])
})

Deno.test('an ordinary predicate is left alone for the query compiler', () => {
  let m = match('.doc.title=Dune')
  assertEquals(m.patterns[0].binds, [])
  assertEquals(m.patterns[0].filter.clauses.length, 1)
})

Deno.test('a pattern names one entity', () => {
  assertThrows(() => match('$a $b .call'), Error, 'names one entity')
})

Deno.test('a rule needs a pattern', () => {
  assertThrows(() => match('  ;  '), Error, 'needs a pattern')
})

Deno.test('what a match reads is what an overlay must cover', () => {
  assertEquals(
    reads(match('$c .call; .result, result.call=$c, +!doc'), vocab).sort(),
    ['call', 'doc', 'result'],
  )
  // A bare word is routed: `.title` is the `doc` component's property.
  assertEquals(reads(match('.title=Dune'), vocab), ['doc'])
  // A removal is a read: the overlay carries the batch's deletions only for
  // the components it covers.
  assertEquals(reads(match('.call, -result'), vocab).sort(), ['call', 'result'])
})

Deno.test('a removal of a word this vocabulary lacks is inert', () => {
  // Nothing here can wear `wake`, so nothing here can lose it either — the
  // opposite of an absence, which is trivially true where the word is unknown.
  assertEquals(asked(match('.call, -wake'), vocab), null)
  let m = match('.call, -result')
  assertEquals(asked(m, vocab), m)
})

// A template is the same object as a rule, and an invocation is that query
// merged with a bindings-only query built from the arguments (T-37570).

Deno.test('a bindings query is a query, and it is nothing but bindings', () => {
  assertEquals(bound('$x=5 $who=ada'), { x: '5', who: 'ada' })
})

Deno.test('a bound variable in a write position supplies the value', () => {
  // Jeff's own example: `+foo.bar=$x` merged with `$x=5` creates an entity
  // with bar=5.
  let m = filled('+result.ms=$x', { x: 5 })
  assertEquals(m.patterns[0].sets, [{
    comp: 'result',
    prop: 'ms',
    value: { kind: 'scalar', raw: '5' },
  }])
  // With no `+` comp matched, the pattern still makes its entity.
  assertEquals(m.patterns[0].makes, true)
  assertEquals(m.vars, [])
})

Deno.test('a bound variable in a match position constrains', () => {
  let m = filled('.result, result.ms=$x', { x: 5 })
  assertEquals(m.patterns[0].binds, [])
  // It became the ordinary predicate it always was.
  assertEquals(m.patterns[0].filter.clauses.length, 2)
  assertEquals(m.patterns[0].makes, false)
})

Deno.test('a variable in both places joins and supplies at once', () => {
  let m = filled('$c .call; +result.call=$c', {})
  // Unbound, it is the join it looks like.
  assertEquals(m.vars, ['c'])
  assertEquals(m.patterns[0].entity, 'c')
  // Bound, the first pattern names one entity and the second writes it.
  let one = filled('$c .call; +result.call=$c', { c: 'c1' })
  assertEquals(one.patterns[0].entity, undefined)
  assertEquals(one.patterns[1].sets[0].value, { kind: 'scalar', raw: 'c1' })
  assertEquals(one.vars, [])
})

Deno.test('arguments may be a query or a plain object', () => {
  assertEquals(
    filled('+result.ms=$x', '$x=5').patterns[0].sets[0].value,
    filled('+result.ms=$x', { x: '5' }).patterns[0].sets[0].value,
  )
})

// `asked`: the same sentence, read by two vocabularies.

Deno.test('a clause about a word this vocabulary lacks, absent, says nothing', () => {
  let m = asked(match('$call .call, !results, !wake'), vocab)!
  // `wake` is not a word here, so nothing can wear it and the clause is out;
  // `results` is, so the gate it states stands.
  assertEquals(m.patterns[0].filter.clauses.length, 2)
  assertEquals(m.patterns[0].entity, 'call')
})

Deno.test('a clause about a word this vocabulary lacks, present, is inert', () => {
  assertEquals(
    asked(match('$call .call, .wake, .fired, !results'), vocab),
    null,
  )
})

Deno.test('a match this vocabulary knows every word of is itself', () => {
  let m = match('$call .call, !results')
  assertEquals(asked(m, vocab), m)
})
