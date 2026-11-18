import { clock, equal, test } from '@yaks/testing'
import { coalesced, doorOf, IDEMPOTENCY, resending } from './door.ts'

let fixture = () => {
  let calls: Request[] = [], held: Promise<void>[] = []
  let answers: ((r: Response) => void)[] = []
  let queued: (() => void)[] = []
  let time = clock()
  let door = coalesced(
    doorOf((r) => {
      calls.push(r)
      return new Promise<Response>((answer) => answers.push(answer))
    }),
    (r) => new URL(r.url).pathname == '/query',
    {
      hold: (work) => held.push(work),
      turn: (send) => queued.push(send),
      clock: time,
    },
  )
  let answer = (n: number, body: string) =>
    answers[n](new Response(body, { headers: { 'x-revision': body } }))
  let flush = () => queued.splice(0).forEach((send) => send())
  return { door, calls, held, answer, answers, flush, queued, time }
}

test('queued reads share one trip and each gets its own bytes', async () => {
  let f = fixture()
  let reads = Array.from(
    { length: 100 },
    () => f.door.consume('/query?q=x', (r) => r.text()),
  )
  f.flush()
  equal(f.calls.length, 1)
  equal(f.held.length, 1)
  f.answer(0, 'first')
  equal(await Promise.all(reads), Array(100).fill('first'))
  await Promise.all(f.held)
  let next = f.door('/query?q=x')
  f.flush()
  equal(f.calls.length, 2)
  f.answer(1, 'second')
  let response = await next
  equal([await response.text(), response.headers.get('x-revision')], [
    'second',
    'second',
  ])
})

test('read sharing separates queries and callers with different standing', async () => {
  let f = fixture()
  let reads = [
    f.door('/query?q=a', {}, { 'x-person': 'alice' }),
    f.door('/query?q=a', {}, { 'x-person': 'bob' }),
    f.door('/query?q=b', {}, { 'x-person': 'alice' }),
  ]
  f.flush()
  equal(f.calls.length, 3)
  reads.forEach((_, n) => f.answer(n, String(n)))
  equal(await Promise.all(reads.map(async (r) => (await r).text())), [
    '0',
    '1',
    '2',
  ])
})

test('a write separates reads and an old answer cannot remove a newer read', async () => {
  let f = fixture()
  let first = f.door('/query')
  f.flush()
  let write = f.door('/apply', { method: 'POST', body: 'change' })
  f.answer(1, 'written')
  await (await write).body?.cancel()
  let next = f.door('/query')
  f.answer(0, 'old')
  equal(await (await first).text(), 'old')
  let joined = f.door('/query')
  f.flush()
  equal(f.calls.length, 3)
  f.answer(2, 'new')
  equal(await Promise.all([next, joined].map(async (r) => (await r).text())), [
    'new',
    'new',
  ])
})

test('a failed body fails its readers and the next read starts anew', async () => {
  let f = fixture()
  let reads = [f.door('/query'), f.door('/query')]
  f.flush()
  let failure = Error('broken body')
  f.answers[0](
    new Response(
      new ReadableStream({
        start: (c) => c.error(failure),
      }),
    ),
  )
  equal((await Promise.allSettled(reads)).map((r) => r.status), [
    'rejected',
    'rejected',
  ])
  let next = f.door('/query')
  f.flush()
  equal(f.calls.length, 2)
  f.answer(1, 'recovered')
  equal(await (await next).text(), 'recovered')
})

test('callers during a read share the next one, sent once it lands', async () => {
  let f = fixture()
  let first = f.door('/query')
  f.flush()
  let later = Array.from({ length: 50 }, () => f.door('/query'))
  let other = f.door('/query?q=other')
  f.flush()
  equal(f.calls.length, 2)
  f.answer(0, 'before')
  equal(await (await first).text(), 'before')
  f.flush()
  equal(f.calls.length, 3)
  let after = f.door('/query')
  f.flush()
  f.answer(2, 'next')
  equal(
    await Promise.all(later.map(async (r) => (await r).text())),
    Array(50).fill('next'),
  )
  f.flush()
  equal(f.calls.length, 4)
  f.answer(1, 'other')
  f.answer(3, 'last')
  equal(await Promise.all([other, after].map(async (r) => (await r).text())), [
    'other',
    'last',
  ])
})

test('a read that fails still sends the one waiting behind it', async () => {
  let f = fixture()
  let first = f.door('/query')
  f.flush()
  let later = f.door('/query')
  f.answers[0](
    new Response(new ReadableStream({ start: (c) => c.error(Error('cut')) })),
  )
  equal((await Promise.allSettled([first])).map((r) => r.status), ['rejected'])
  f.flush()
  f.answer(1, 'again')
  equal(await (await later).text(), 'again')
})

test('a completed write separates reads begun while it was running', async () => {
  let f = fixture()
  let write = f.door('/apply', { method: 'POST' })
  let during = f.door('/query')
  f.flush()
  f.answer(0, 'written')
  await (await write).body?.cancel()
  let after = f.door('/query')
  f.flush()
  equal(f.calls.length, 3)
  f.answer(1, 'before commit')
  f.answer(2, 'after commit')
  equal(await Promise.all([during, after].map(async (r) => (await r).text())), [
    'before commit',
    'after commit',
  ])
})

test('coalescing preserves a resending write and its idempotency key', async () => {
  let calls: Request[] = []
  let door = coalesced(
    resending(
      doorOf((r) => {
        calls.push(r)
        return calls.length == 1
          ? Promise.reject(Error('Network connection lost.'))
          : Promise.resolve(Response.json({ ok: true }))
      }),
      { wait: () => Promise.resolve() },
    ),
    () => true,
  )
  equal(
    await door.consume('/apply', (r) => r.json(), {
      method: 'POST',
      body: 'change',
    }),
    { ok: true },
  )
  equal(await Promise.all(calls.map((r) => r.text())), ['change', 'change'])
  equal(calls.map((r) => r.headers.get(IDEMPOTENCY)), [
    calls[0].headers.get(IDEMPOTENCY),
    calls[0].headers.get(IDEMPOTENCY),
  ])
})

test('a shared read keeps call headers the inner door scrubs from its init', async () => {
  let seen: (string | null)[] = []
  let door = coalesced(
    doorOf((r) => {
      seen.push(r.headers.get('x-static'))
      return Promise.resolve(new Response('ok'))
    }, ['x-static']),
    () => true,
  )
  await door.consume('/query?q=x', (r) => r.text(), {}, { 'x-static': '1' })
  equal(seen, ['1'])
})

test('callers behind a read whose sender ended board again once patience runs out', async () => {
  let f = fixture()
  let first = f.door('/query')
  f.flush()
  await f.time.advance(1_000)
  let behind = [f.door('/query'), f.door('/query')]
  f.flush()
  equal(f.calls.length, 1)
  await f.time.advance(14_000)
  f.flush()
  equal(f.calls.length, 2)
  f.answer(1, 'again')
  equal(
    await Promise.all([first, ...behind].map(async (r) => (await r).text())),
    [
      'again',
      'again',
      'again',
    ],
  )
  let next = f.door('/query')
  f.flush()
  f.answer(2, 'healed')
  equal(await (await next).text(), 'healed')
})

test('callers in a batch its opener never sent board again once patience runs out', async () => {
  let f = fixture()
  let reads = [f.door('/query'), f.door('/query')]
  await Promise.resolve()
  f.queued.splice(0)
  await f.time.advance(15_000)
  f.flush()
  equal(f.calls.length, 1)
  f.answer(0, 'sent')
  equal(await Promise.all(reads.map(async (r) => (await r).text())), [
    'sent',
    'sent',
  ])
})
