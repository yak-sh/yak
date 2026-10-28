// A delayed store answer must still decide which hero the gate shows.
import { clock, test, tick } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { once } from './once.ts'

test('a delayed query returns its rows instead of an empty answer', async () => {
  let calls = 0, time = clock()
  let rows = once<{ player: object }>(
    new URL('https://example.test/vale/api/query?.player'),
    (_, { signal }) => {
      calls++
      return calls == 1
        ? new Promise((_, fail) =>
          signal!.addEventListener('abort', () => fail(signal!.reason))
        )
        : Promise.resolve(Response.json([{ player: {} }]))
    },
    time,
  )
  await time.advance(8000)
  await tick()
  assertEquals(calls, 1)
  await time.advance(1000)
  assertEquals(await rows, [{ player: {} }])
  assertEquals(calls, 2)
})

test('a refused query cannot say this person has no hero', async () => {
  let calls = 0
  await assertRejects(
    () =>
      once(
        new URL('https://example.test/vale/api/query?.player'),
        () => (calls++, Promise.resolve(new Response('', { status: 400 }))),
        clock(),
      ),
    Error,
    '400',
  )
  assertEquals(calls, 1)
})
