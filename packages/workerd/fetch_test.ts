import { clock, test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { type Bound, resending } from './fetch.ts'

let request = (method = 'GET', headers = {}) =>
  new Request('https://service.invalid/mcp', { method, headers })
let door = (...answers: (() => Promise<Response>)[]) => {
  let sent: Request[] = []
  let bound: Bound = {
    fetch: (req) => {
      sent.push(req)
      return answers[sent.length - 1]()
    },
  }
  return { bound, sent }
}
let answer = () => Promise.resolve(new Response(null, { status: 401 }))

test('an unanswered service read resends once and aborts the lost hop', async () => {
  let time = clock(), lost = Promise.withResolvers<Response>()
  let d = door(() => lost.promise, answer)
  let result = resending(d.bound, request(), time)
  await time.advance(4999)
  assertEquals(d.sent.length, 1)
  await time.advance(1)
  assertEquals((await result).status, 401)
  assertEquals(d.sent.length, 2)
  assertEquals(d.sent[0].signal.aborted, true)
  // A binding that ignores cancellation can still return late; its body is
  // discarded rather than leaked or allowed to replace the retry's answer.
  let canceled = false
  lost.resolve(
    new Response(
      new ReadableStream({
        cancel: () => void (canceled = true),
      }),
    ),
  )
  await time.advance(0)
  assertEquals(canceled, true)
})

test('an answering service keeps its stream and never resends it', async () => {
  let time = clock(), stream = new ReadableStream()
  let d = door(() => Promise.resolve(new Response(stream)))
  let result = await resending(d.bound, request(), time)
  await time.advance(60_000)
  assertEquals(d.sent.length, 1)
  assertEquals(d.sent[0].signal.aborted, false)
  assertEquals(result.body, stream)
  await stream.cancel()
})

test('a slow second read is left running rather than resent again', async () => {
  let time = clock(), first = Promise.withResolvers<Response>()
  let final = Promise.withResolvers<Response>()
  let d = door(() => first.promise, () => final.promise)
  let result = resending(d.bound, request('HEAD'), time)
  await time.advance(5000)
  await time.advance(55_000)
  assertEquals(d.sent.length, 2)
  final.resolve(new Response(null, { status: 503 }))
  assertEquals((await result).status, 503)
  first.reject(new DOMException('aborted', 'AbortError'))
})

test('writes and upgrades keep one send even when unanswered', async () => {
  for (let req of [request('POST'), request('GET', { upgrade: 'websocket' })]) {
    let time = clock(), held = Promise.withResolvers<Response>()
    let d = door(() => held.promise)
    let result = resending(d.bound, req, time)
    await time.advance(60_000)
    assertEquals(d.sent.length, 1)
    assertEquals(d.sent[0], req)
    held.resolve(await answer())
    assertEquals((await result).status, 401)
  }
})

test('a thrown service failure and an answered error propagate', async () => {
  let time = clock()
  let broken = door(() => Promise.reject(new Error('broken')))
  await assertRejects(
    () => resending(broken.bound, request(), time),
    Error,
    'broken',
  )
  await time.advance(60_000)
  assertEquals(broken.sent.length, 1)
  let failed = door(() => Promise.resolve(new Response(null, { status: 500 })))
  assertEquals((await resending(failed.bound, request(), time)).status, 500)
  await time.advance(60_000)
  assertEquals(failed.sent.length, 1)
})

test('a canceled caller starts no resend', async () => {
  let time = clock(), stop = new AbortController()
  let d = door(() => Promise.reject(stop.signal.reason))
  stop.abort()
  await assertRejects(() =>
    resending(d.bound, new Request(request(), { signal: stop.signal }), time)
  )
  await time.advance(60_000)
  assertEquals(d.sent.length, 1)
})
