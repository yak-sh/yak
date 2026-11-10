// A watched exchange fails as stalled once its source goes quiet, whether
// before the head or between chunks; a caller's stop stays its own, and only
// the wait on the source counts.

import { assertEquals, assertInstanceOf, assertRejects } from '@std/assert'
import { clock, test, tick } from '@yaks/testing'
import { STALL_TIMEOUT, Stalled, stallMs, watched } from './stall.ts'

// A server the test talks through: `head()` answers, `say()` sends a chunk.
let server = () => {
  let time = clock()
  let source!: ReadableStreamDefaultController<Uint8Array>
  let cancelled = false
  let answer!: (r: Response) => void
  let fetch =
    ((_: unknown, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        answer = resolve
        init?.signal?.addEventListener(
          'abort',
          () => reject(init.signal!.reason),
        )
      })) as typeof globalThis.fetch
  return {
    time,
    fetch: watched(fetch, 100, time),
    cancelled: () => cancelled,
    head: () =>
      answer(
        new Response(
          new ReadableStream<Uint8Array>({
            start: (c) => void (source = c),
            cancel: () => void (cancelled = true),
          }),
        ),
      ),
    say: (text: string) => source.enqueue(new TextEncoder().encode(text)),
  }
}

test('a head that never arrives fails as stalled', async () => {
  let s = server()
  let asked = s.fetch('https://x')
  await s.time.advance(99)
  await s.time.advance(1)
  assertInstanceOf(await asked.catch((e) => e), Stalled)
})

test('each chunk keeps a stream alive and a quiet gap fails its read', async () => {
  let s = server()
  let asked = s.fetch('https://x')
  s.head()
  let reader = (await asked).body!.getReader()
  for (let word of ['a', 'b']) {
    let read = reader.read()
    await s.time.advance(90)
    s.say(word)
    assertEquals(new TextDecoder().decode((await read).value), word)
  }
  // A reader slow to ask again is not a quiet server.
  await s.time.advance(500)
  let read = reader.read()
  await s.time.advance(100)
  await assertRejects(() => read, Stalled, 'no progress for 0.1s')
  await tick()
  assertEquals(s.cancelled(), true)
})

test("a caller's stop fails with its own reason, not as a stall", async () => {
  let s = server()
  let stop = new AbortController()
  let asked = s.fetch('https://x', { signal: stop.signal })
  stop.abort(new Error('withdrawn'))
  let failed = await asked.catch((e) => e)
  assertEquals([failed instanceof Stalled, failed.message], [
    false,
    'withdrawn',
  ])
})

test('a request names its own stall timeout; 0 waits for ever', () => {
  assertEquals(stallMs({}), STALL_TIMEOUT * 1000)
  assertEquals(stallMs({ stallTimeout: 30 }), 30_000)
  assertEquals(stallMs({ stallTimeout: 0 }), 0)
  assertEquals(watched(fetch, 0), fetch)
})
