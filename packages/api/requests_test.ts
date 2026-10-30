/// <reference lib="deno.ns" />
// Request owners end before their reader closes; admitted writes keep going.
import { equal, test } from '@yaks/testing'
import { served } from './request.ts'
import { requests } from './requests.ts'
import { faults, refuse } from './refuse.ts'

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

// A failure `refuse` answers under a watch is the watch's to report, once,
// with its error: to the host's report, or through `fault` without one.
let refused = async (report: boolean) => {
  let error = new Error('disk gone'), told: unknown[] = []
  let remove = faults((e, where) => told.push([e, where]))
  try {
    let answer = await served(
      (request) => refuse(error, request),
      report ? { report: (_request, e) => told.push(e) } : {},
    )(new Request('http://test/blob/x?token=1'))
    return { error, told, id: answer.headers.get('x-request-id') }
  } finally {
    remove()
  }
}

test('a failure refuse answers under a watch is reported once, with its error', async () => {
  let hosted = await refused(true)
  equal(hosted.told, [hosted.error])
  let bare = await refused(false)
  equal(bare.told, [[bare.error, `GET /blob/x (request ${bare.id})`]])
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

test('shutdown surfaces an unexpected response cancellation failure', async () => {
  let error = new Error('stream cleanup failed')
  let active = requests(() =>
    new Response(
      new ReadableStream({
        cancel: () => Promise.reject(error),
      }),
    )
  )
  await active.handle(new Request('http://test/events'))
  active.cancel()
  let failed: unknown
  try {
    await active.drain()
  } catch (caught) {
    failed = caught
  }
  equal(failed instanceof AggregateError && failed.errors, [error])
})

// A runtime upgrade is opaque, not an ordinary HTTP response body. Its identity
// is how Deno associates the returned response with the upgraded socket.
let upgraded = {
  status: 101,
  body: new ReadableStream<Uint8Array>(),
} as Response
let upgradeIncoming = new Request('http://test/ws', {
  headers: { upgrade: 'websocket' },
})
let upgradeSeen: Request | undefined
let upgradeRequests = requests((request) => {
  upgradeSeen = request
  return upgraded
})
let upgradeAnswer = await upgradeRequests.handle(upgradeIncoming)
let upgradeHeld = upgradeRequests.open()
upgradeRequests.cancel()
await upgradeRequests.drain()
test('an upgraded socket response is handed back intact rather than streamed', () => {
  equal(upgradeSeen, upgradeIncoming)
  equal(upgradeAnswer, upgraded)
  equal(upgradeHeld, [])
})

// Deno aborts the successful upgrade's HTTP request. Cancellation must not
// replace its opaque 101 while the request wrapper unwinds.
let abortUpgrade = new AbortController()
let upgrades = requests(served(async () => {
  await Promise.resolve()
  abortUpgrade.abort()
  return upgraded
}, {}))
let abortAnswer = await upgrades.handle(
  new Request('http://test/ws', {
    headers: { upgrade: 'websocket' },
    signal: abortUpgrade.signal,
  }),
)
test('successful upgrade request abort cannot replace its runtime response', () => {
  equal(abortAnswer, upgraded)
})
