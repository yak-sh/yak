import { equal, test } from '@yaks/testing'
import { pollThread } from './poll_thread.ts'
import { poll } from './poll.ts'

// Start the real network pair at module load; test budgets measure assertions,
// not the compiler/worker startup on a loaded box.
let peer = new Worker(new URL('./poll_peer.ts', import.meta.url), {
  type: 'module',
})
let { url } = await new Promise<{ url: string }>((done) =>
  peer.onmessage = (e) => done(e.data)
)
let doors = pollThread({ url, secret: 'test-only' })
let params = new URLSearchParams({ limit: '100', query: '.bug' })
let first = await doors.bugs(params, new AbortController().signal)
await doors.mark('bug', 'taken', { task: 'T-7' })
let calls = await new Promise<{ path: string; body: unknown }[]>((done) => {
  peer.onmessage = (e) => done(e.data)
  peer.postMessage('calls')
})
// Hold the host loop synchronously until the peer sees each signed request.
// Only an independent network loop can reach it while this one is asleep.
let isolated: string[] = []
for (let kind of ['read', 'mark']) {
  let watched = new Int32Array(new SharedArrayBuffer(4))
  await new Promise<void>((done) => {
    peer.onmessage = () => done()
    peer.postMessage({ watch: watched.buffer })
  })
  let reply = kind == 'read'
    ? doors.bugs(params, new AbortController().signal)
    : doors.mark('bug', 'archived', {})
  isolated.push(Atomics.wait(watched, 0, 0, 1000))
  await reply
}
doors.close()
peer.terminate()

test('the poll thread reads and marks through real signed doors', () => {
  equal(first, {
    ok: true,
    value: [{ entity: { eid: 'bug' }, bug: { fault: 'one' } }],
  })
  equal(calls.map((c) => [c.path, c.body]), [
    ['/bugs', undefined],
    ['/take', { bug: 'bug', task: 'T-7' }],
  ])
})

test('signed reads and marks reach the peer while the host loop is blocked', () =>
  equal(isolated.every((result) => result != 'timed-out'), true))

test('closing poll doors rejects reads and marks without starting a worker', async () => {
  let closed = pollThread({ url: 'http://127.0.0.1:1', secret: 'test-only' })
  closed.close()
  equal(
    await closed.bugs(params, new AbortController().signal).catch(String),
    'Error: Remote tracker poll is closed',
  )
  equal(
    await closed.mark('bug', 'archived', {}).catch(String),
    'Error: Remote tracker poll is closed',
  )
})

// Closing while a read is in flight owns and cancels the whole thread. Its
// rejected page must not schedule a fresh inter-poll timer after shutdown.
let timers = 0
let closing = poll({ url: 'http://127.0.0.1:1', secret: 'test-only' }, '.bug', {
  timer: () => {
    timers++
    return () => {}
  },
})
closing.close()
await new Promise<void>((done) => setTimeout(done, 0))
test('closing a poll during its page leaves no next-poll timer', () =>
  equal(timers, 0))
