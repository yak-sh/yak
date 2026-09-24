import { assertEquals } from '@std/assert'
import { actionable, faultKey, normalize, recurred, severity } from './fault.ts'

let same = (a: string, b: string) => assertEquals(normalize(a), normalize(b))

Deno.test('the volatile parts of a message fold away', () => {
  same(
    'T-42 failed at /srv/app.ts:10:3 after 300 tries',
    'S-7 failed at /home/x/y.ts:99:1 after 2 tries',
  )
  same(
    'savepoint tx_947 at 2026-09-24T10:00:00.000Z',
    'savepoint tx_3 at 2026-01-01T00:00:00Z',
  )
  same('row 1f2e3d4c gone', 'row abcdef12 gone')
  same(
    'no entity 0a1b2c3d-1111-4222-8333-444455556666',
    'no entity 9f8e7d6c-aaaa-4bbb-8ccc-ddddeeeeffff',
  )
  assertEquals(
    normalize('T-42 failed at /srv/app.ts:10:3 after 300 tries'),
    '# failed at # after # tries',
  )
})

Deno.test('the key is the kind, the message and the top frame', () => {
  let stack = 'Error: x\n    at run (/a.ts:4:1)\n    at main (/b.ts:1:1)'
  assertEquals(
    faultKey('session', 'exit 127 in S-9', stack),
    'session:exit # in #@at run (#)',
  )
  assertEquals(faultKey('session', 'exit 1'), 'session:exit #')
  // Another site is another fault, and so is another kind.
  let there = 'Error: x\n    at walk (/a.ts:9:1)'
  assertEquals(
    faultKey('session', 'boom', stack) == faultKey('session', 'boom', there),
    false,
  )
  assertEquals(faultKey('task', 'boom') == faultKey('session', 'boom'), false)
})

Deno.test('a transient is not worth a task', () => {
  for (
    let m of [
      'fetch timed out',
      'resource temporarily unavailable',
      'ECONNRESET',
      'responses: HTTP 503',
      'responses: transport failed',
    ]
  ) assertEquals(actionable(m), false, m)
  assertEquals(actionable('no such table: bug'), true)
})

Deno.test('a missing thing files ahead of an odd one', () => {
  assertEquals(severity('exit 127: codex not found'), 1)
  assertEquals(severity('unable to open database'), 1)
  assertEquals(severity('exit 0'), 2)
  assertEquals(severity('unexpected token'), 2)
})

Deno.test('the recurrence line is replaced, never stacked', () => {
  let once = recurred('it broke', 2, 'noon')
  assertEquals(once, 'it broke\n\n— ↻ recurred 2× · last seen noon')
  assertEquals(
    recurred(once, 3, 'one'),
    'it broke\n\n— ↻ recurred 3× · last seen one',
  )
})
