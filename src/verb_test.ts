// The verb vocabulary is executable data: finite kinds teach and validate,
// while usage and arity are mechanical renderings of one declaration.

import { assertEquals } from '@std/assert'
import { comps } from './types.ts'
import { enumOf, id, of, text, usageOf, type Verb, wordsOf } from './verb.ts'

let verb = (
  shape: Omit<Verb, 'name' | 'about' | 'door'>,
): Verb => ({
  name: 'try',
  about: 'exercise the declaration',
  door: ['cli'],
  ...shape,
})

Deno.test('usage renders finite options, defaults and required alternatives', () => {
  let model = of('model', () => ['short', 'also-short'])
  assertEquals(
    usageOf(verb({
      args: [{ name: 'id', kind: id }],
      opts: [
        { name: '--model', kind: model },
        { name: '--effort', kind: text, or: 'high' },
      ],
    })),
    'try <id> [--model=short|also-short] [--effort=high]',
  )
  assertEquals(
    usageOf(verb({
      opts: [{ name: '--body', kind: text }],
      some: ['--body'],
    })),
    'try --body=TEXT',
  )
})

Deno.test('words derive from required, optional and trailing positionals', () => {
  assertEquals(wordsOf(verb({ args: [] })), [0, 0])
  assertEquals(
    wordsOf(verb({
      args: [
        { name: 'id', kind: id },
        { name: 'text', kind: text, rest: true, need: false },
      ],
    })),
    [1],
  )
})

Deno.test('enumOf accepts the graph enum and its input aliases', () => {
  assertEquals(enumOf(comps.review.verdict).of?.(), [
    'approved',
    'rejected',
    'changes_requested',
    'approve',
    'reject',
    'changes',
  ])
})
