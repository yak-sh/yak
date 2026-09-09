import { assertEquals, assertRejects } from '@std/assert'
import { frames, ResponseError, type ResponseEvent } from './mod.ts'

Deno.test('SSE handles byte splits, UTF-8, CRLF, multiline data, DONE and trailing data', async () => {
  let bytes = new TextEncoder().encode(
    ': comment\r\nevent: ignored\r\ndata: {"type":"delta",\r\ndata: "delta":"hé🙂"}\r\n\r\n' +
      'data: [DONE]\n\ndata: {"type":"last"}',
  )
  let stream = new ReadableStream<Uint8Array>({
    start(control) {
      for (let byte of bytes) control.enqueue(new Uint8Array([byte]))
      control.close()
    },
  })
  let out: ResponseEvent[] = []
  for await (let event of frames(stream)) out.push(event)
  assertEquals(out, [{ type: 'delta', delta: 'hé🙂' }, { type: 'last' }])
  assertEquals(stream.locked, false)
})

Deno.test('SSE cancels and releases its reader on malformed frames or early exit', async () => {
  for (let data of ['{no}', '{}', '{"type":"delta"}']) {
    let cancelled = false
    let stream = new ReadableStream<Uint8Array>({
      start(control) {
        control.enqueue(new TextEncoder().encode(`data: ${data}\n\n`))
      },
      cancel() {
        cancelled = true
      },
    })
    let consume = async () => {
      for await (let _event of frames(stream)) break
    }
    if (data.includes('delta')) await consume()
    else await assertRejects(consume, ResponseError)
    assertEquals(cancelled, true)
    assertEquals(stream.locked, false)
  }
})
