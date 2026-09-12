import { assertEquals, assertThrows } from '@std/assert'
import { parseJoinRule } from './join.ts'
Deno.test('join curly shorthand is named and semicolons preserve entity targets', () => {
  assertEquals(
    parseJoinRule(
      '$call .entry{$session} .call; .result{$call} +!entry{$session}',
    ),
    {
      kind: 'join-rule',
      patterns: [
        {
          variable: 'call',
          match: [{
            component: 'entry',
            bindings: [{ property: 'session', variable: 'session' }],
          }, { component: 'call', bindings: [] }],
          gates: [],
        },
        {
          match: [{
            component: 'result',
            bindings: [{ property: 'call', variable: 'call' }],
          }],
          gates: [{
            component: 'entry',
            bindings: [{ property: 'session', variable: 'session' }],
          }],
        },
      ],
    },
  )
  assertEquals(
    parseJoinRule('.foo{$bar, baz: $baz}'),
    parseJoinRule('.foo{bar: $bar, baz: $baz}'),
  )
})
Deno.test('join parser refuses unsupported or malformed forms', () => {
  for (
    const source of [
      '',
      '.foo($bar)',
      '.foo +entry',
      '.foo;',
      '.foo{a: 2}',
      '.foo{$a, a: $b}',
      '.foo{$a',
      '; .foo',
    ]
  ) {
    assertThrows(() => parseJoinRule(source), SyntaxError)
  }
})
