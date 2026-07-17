import { assert, assertEquals } from '@std/assert'
import { drop, focused, peek, save } from './drafts.ts'

Deno.test('drafts: save/peek/drop round-trip; focus follows the pen', () => {
  save('a', 'hello', 3)
  assertEquals(peek('a')?.v, 'hello')
  assertEquals(peek('a')?.caret, 3)
  assert(focused('a'))
  save('b', 'x')
  assert(!focused('a'), 'the newest save owns the focus')
  drop('a')
  assertEquals(peek('a'), null)
  drop('b')
  assert(!focused('b'), 'dropping the focused key clears the heir')
})

Deno.test('drafts: never expire — only commit or revert spends one', () => {
  save('old', 'yesterday')
  assertEquals(peek('old')?.v, 'yesterday')
  drop('old')
  assertEquals(peek('old'), null)
})
