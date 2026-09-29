// A delayed store answer must still decide which hero the gate shows.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { once } from './once.ts'

test('a delayed query returns its rows instead of an empty answer', async () => {
  let calls = 0
  let rows = await once<{ player: object }>(
    new URL('https://example.test/vale/api/query?.player'),
    () => {
      calls++
      return calls == 1
        ? Promise.reject(new DOMException('signal timed out', 'TimeoutError'))
        : Promise.resolve(Response.json([{ player: {} }]))
    },
    () => Promise.resolve(),
  )
  assertEquals(calls, 2)
  assertEquals(rows, [{ player: {} }])
})

test('a refused query cannot say this person has no hero', async () => {
  let calls = 0
  await assertRejects(
    () =>
      once(
        new URL('https://example.test/vale/api/query?.player'),
        () => (calls++, Promise.resolve(new Response('', { status: 400 }))),
        () => Promise.resolve(),
      ),
    Error,
    '400',
  )
  assertEquals(calls, 1)
})
