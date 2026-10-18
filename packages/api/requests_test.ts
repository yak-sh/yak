// Request owners end before their reader closes; admitted writes keep going.
import { equal, test } from '@yaks/testing'
import { served } from './request.ts'
import { requests } from './requests.ts'

let read = (() => {
  let answer = Promise.withResolvers<Response>(), errors: unknown[] = []
  let finished = Promise.withResolvers<void>()
  let handle = served(() => answer.promise, {
    report: (_request, error) => errors.push(error),
  })
  let active = requests((request) =>
    Promise.resolve(handle(request)).finally(() => finished.resolve())
  )
  return { answer, errors, active, finished }
})()

test('cancelled read owners finish before their reader is closed', async () => {
  let waiting = Array.from(
    { length: 3 },
    () => read.active.handle(new Request('http://test/query')),
  )
  read.active.cancel()
  await read.active.drain()
  let replies = await Promise.all(waiting)
  equal(replies.map((response) => response.status), [499, 499, 499])
  read.answer.reject(new Error('the reader closed'))
  await read.finished.promise
  equal(read.errors, [])
})

let broken = (() => {
  let error = new Error('disk failed'), errors: unknown[] = []
  let active = requests(served(() => Promise.reject(error), {
    report: (_request, error) => errors.push(error),
  }))
  return { error, errors, active }
})()

test('an unexpected read failure is still reported before cancellation', async () => {
  let response = await broken.active.handle(new Request('http://test/query'))
  broken.active.cancel()
  equal(response.status, 500)
  equal(broken.errors, [broken.error])
})

let write = (() => {
  let started = Promise.withResolvers<void>(),
    save = Promise.withResolvers<void>()
  let saved = '', errors: unknown[] = []
  let active = requests(served(async (request) => {
    let body = await request.text()
    started.resolve()
    await save.promise
    saved = body
    return new Response('saved')
  }, { report: (_request, error) => errors.push(error) }))
  return { active, started, save, errors, saved: () => saved }
})()

test('shutdown waits for an admitted write even after its client disconnects', async () => {
  let client = new AbortController()
  let response = write.active.handle(
    new Request('http://test/apply', {
      method: 'POST',
      body: 'precious draft',
      signal: client.signal,
    }),
  )
  await write.started.promise
  client.abort()
  write.active.cancel()
  let drained = false
  let ending = write.active.drain().then(() => drained = true)
  await Promise.resolve()
  equal(drained, false)
  write.save.resolve()
  await ending
  equal((await response).status, 200)
  equal(write.saved(), 'precious draft')
  equal(write.errors, [])
})
