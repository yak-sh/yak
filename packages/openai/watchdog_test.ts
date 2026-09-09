import { assertEquals, assertRejects } from '@std/assert'
import { FakeTime } from '@std/testing/time'
import { transport } from './mod.ts'

Deno.test('watchdog resets on each frame, distinguishes caller stop, and clears its timer', async () => {
  using time = new FakeTime()
  let stream!: ReadableStreamDefaultController<Uint8Array>
  let signal!: AbortSignal
  let client = transport({
    credentials: { get: () => ({ token: 'fake-key' }) },
    stallMs: 100,
    fetch: (_url, init) => {
      signal = init!.signal!
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(control) {
              stream = control
              signal.addEventListener(
                'abort',
                () => stream.error(new DOMException('stopped', 'AbortError')),
              )
            },
          }),
        ),
      )
    },
  })
  let send = async (frame: unknown) => {
    stream.enqueue(
      new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`),
    )
    await time.runMicrotasks()
  }
  let running = client.run({ model: 'm', input: [] })
  await time.runMicrotasks()
  for (let i = 0; i < 3; i++) {
    await time.tickAsync(90)
    assertEquals(signal.aborted, false)
    await send({ type: 'response.output_text.delta', delta: 'progress' })
  }
  await time.tickAsync(90)
  await send({
    type: 'response.completed',
    response: { status: 'completed', model: 'm' },
  })
  stream.close()
  assertEquals((await running).model, 'm')
  await time.tickAsync(1000)
  assertEquals(signal.aborted, false)

  let stop = new AbortController()
  running = client.run({ model: 'm', input: [] }, { signal: stop.signal })
  await time.runMicrotasks()
  let stopped = assertRejects(() => running, DOMException, 'stopped')
  stop.abort()
  await stopped
  await time.tickAsync(1000)
})
