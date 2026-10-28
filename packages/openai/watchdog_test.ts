import { clock, test, tick } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { transport } from './mod.ts'

test('watchdog resets on each frame, distinguishes caller stop, and clears its timer', async () => {
  let time = clock()
  let stream!: ReadableStreamDefaultController<Uint8Array>
  let signal!: AbortSignal
  let client = transport({
    credentials: { get: () => ({ token: 'fake-key' }) },
    stallMs: 100,
    clock: time,
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
    await tick()
  }
  let running = client.run({ model: 'm', input: [] })
  await tick()
  for (let i = 0; i < 3; i++) {
    await time.advance(90)
    assertEquals(signal.aborted, false)
    await send({ type: 'response.output_text.delta', delta: 'progress' })
  }
  await time.advance(90)
  await send({
    type: 'response.completed',
    response: { status: 'completed', model: 'm' },
  })
  stream.close()
  assertEquals((await running).model, 'm')
  await time.advance(1000)
  assertEquals(signal.aborted, false)

  let stop = new AbortController()
  running = client.run({ model: 'm', input: [] }, { signal: stop.signal })
  await tick()
  let stopped = assertRejects(() => running, DOMException, 'stopped')
  stop.abort()
  await stopped
  await time.advance(1000)
})
