// Brackets change the cardinality of a multi-entity match, while each member
// remains an ordinary query.

import { assertEquals, assertThrows } from '@std/assert'
import { parse, parseMatch } from './mod.ts'

Deno.test('a collection nests the same entity queries as a flat match', () => {
  assertEquals(
    parseMatch(
      '$region .region; [$sfx .sfx, sfx.region=$region; [$note .note]]',
    ),
    [
      { kind: 'pattern', query: parse('$region .region', { text: false }) },
      {
        kind: 'collection',
        parts: [
          {
            kind: 'pattern',
            query: parse('$sfx .sfx, sfx.region=$region', { text: false }),
          },
          {
            kind: 'collection',
            parts: [{
              kind: 'pattern',
              query: parse('$note .note', { text: false }),
            }],
          },
        ],
      },
    ],
  )
})

Deno.test('path qualifiers and quoted semicolons stay in their entity', () => {
  assertEquals(
    parseMatch('.requires[<=3]->T-1; [.doc.title="a;b"]')
      .map((part) => part.kind),
    ['pattern', 'collection'],
  )
})

Deno.test('an unclosed or empty collection is refused', () => {
  assertThrows(() => parseMatch('[.sfx'), SyntaxError, 'unclosed')
  assertThrows(() => parseMatch('[]'), SyntaxError, 'empty collection')
  assertThrows(() => parseMatch('[.sfx] .region'), SyntaxError)
})
