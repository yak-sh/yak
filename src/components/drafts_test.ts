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

Deno.test('drafts: a stale draft is dead, not restored', () => {
  save('old', 'yesterday')
  assertEquals(peek('old', Date.now() + 16 * 60_000), null)
  assertEquals(peek('old'), null, 'staleness also reaps the record')
  drop('old')
})
