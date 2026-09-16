// Secrets and entropy leave on the way in; the field is capped last.

import { assertEquals } from '@std/assert'
import { CAP, scrub } from './scrub.ts'

Deno.test('paths, urls, ids, hex, tokens and control bytes are replaced', () => {
  let s = scrub(
    'at https://api.example.com/x?token=abc /home/yaks/code/a.ts ' +
      '550e8400-e29b-41d4-a716-446655440000 deadbeefdeadbeefdeadbeef ctrl\x07bell',
  )!
  assertEquals(s.includes('example.com'), false)
  assertEquals(s.includes('«url»'), true)
  assertEquals(s.includes('~/code/a.ts'), true)
  assertEquals(s.includes('«id»'), true)
  assertEquals(s.includes('«hex»'), true)
  // deno-lint-ignore no-control-regex -- the BEL is gone
  assertEquals(/[\x00-\x08]/.test(s), false)
})

Deno.test('long text is clipped to CAP; null stays null', () => {
  assertEquals(scrub('la '.repeat(2000))!.length, CAP)
  assertEquals(scrub('short'), 'short')
  assertEquals(scrub(null), null)
  assertEquals(scrub(undefined), null)
})
