// The public client asks a read once however many callers want it at the
// same moment, and each caller still holds its own answer; a subscription's
// first rows are a promise a page can wait on.
import { assertEquals, assertNotStrictEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import { clock, test } from '@yaks/testing'
import { store } from './public/client.js'

let base = 'https://reads-client.test/house/api/'
let asked = (
  answer: (path: string) => unknown,
  status = 200,
) => {
  let paths: string[] = []
  let fetching = stub(globalThis, 'fetch', async (url) => {
    let path = String(url).slice(base.length)
    paths.push(path)
    return Response.json(await answer(path), { status })
  })
  // A socket that never opens, so a subscription's rows come over HTTP.
  let socket = stub(
    globalThis,
    'WebSocket',
    function () {
      return { readyState: 0, send() {}, close() {} }
    },
  )
  return {
    paths,
    [Symbol.dispose]: () => (fetching.restore(), socket.restore()),
  }
}

test('reads asked together are one request, each caller its own rows', async () => {
  using wire = asked((path) =>
    path == 'me' ? { person: 'jo' } : [{ entity: { eid: path } }]
  )
  let client = store(base)
  let [one, two] = await Promise.all([client.me(), client.me()])
  let [rows, same, other] = await Promise.all([
    client.query('.house_item'),
    client.query('.house_item'),
    client.query('.house_file'),
  ])
  assertEquals(wire.paths, ['me', 'query?.house_item', 'query?.house_file'])
  assertEquals([one, two], [{ person: 'jo' }, { person: 'jo' }])
  assertNotStrictEquals(one, two)
  assertEquals(rows, same)
  assertNotStrictEquals(rows, same)
  assertEquals(other, [{ entity: { eid: 'query?.house_file' } }])
})

test('a read asked again after its answer is asked again', async () => {
  using wire = asked(() => ({ person: 'jo' }))
  let client = store(base)
  await client.me()
  await client.me()
  assertEquals(wire.paths, ['me', 'me'])
})

test('a read on its way when a write lands answers nobody who asks after', async () => {
  let open = () => {}
  let gate = new Promise<void>((on) => open = on)
  using wire = asked(async (path) => {
    if (path == 'query?.house_item' && wire.paths.length == 1) await gate
    return path == 'query?.house_item' ? [] : { path }
  })
  let client = store(base)
  let early = client.query('.house_item')
  await client.publish(new Blob(['<p>hi']), 'hi.html')
  let late = client.query('.house_item')
  open()
  await Promise.all([early, late])
  assertEquals(wire.paths, [
    'query?.house_item',
    'public/hi.html',
    'query?.house_item',
  ])
})

test("a subscription's ready is the first rows its callback is handed", async () => {
  using wire = asked(() => [{ entity: { eid: 'a' } }])
  let heard: unknown[] = []
  let live = store(base).subscribe(
    '.house_item',
    (rows: unknown) => heard.push(rows),
  )
  let rows = await live.ready
  assertEquals(rows, [{ entity: { eid: 'a' } }])
  assertEquals(heard, [rows])
  assertEquals(wire.paths, ['query?.house_item'])
  live()
})

test("a subscription's ready rejects with the store's refusal", async () => {
  using _wire = asked(() => ({ error: { message: 'no component house' } }), 400)
  let live = store(base).subscribe('.house', () => {})
  await assertRejects(() => live.ready, Error, 'no component house')
  live()
})

// A connection that is away for the first `drops` reads of each path, then
// answers; what the page heard of it is `yak-reconnecting`'s details.
let dropping = (drops: number, answer: (path: string) => unknown) => {
  let missed = new Map<string, number>()
  let heard: boolean[] = []
  let on = (e: Event) => heard.push((e as CustomEvent).detail)
  addEventListener('yak-reconnecting', on)
  let wire = asked((path) => {
    let n = missed.get(path) ?? 0
    missed.set(path, n + 1)
    if (n < drops && path != 'apply') throw new TypeError('Failed to fetch')
    return answer(path)
  })
  return {
    heard,
    paths: wire.paths,
    [Symbol.dispose]: () => (
      wire[Symbol.dispose](), removeEventListener('yak-reconnecting', on)
    ),
  }
}

// Time passes in steps, so a retry a wait sets off sets its next wait in time.
let pass = async (time: ReturnType<typeof clock>, ms: number) => {
  for (let t = 0; t < ms; t += 500) await time.advance(500)
}

test('a read with no answer is asked again, and the page hears it reconnect', async () => {
  using wire = dropping(2, () => [{ entity: { eid: 'a' } }])
  let time = clock()
  let rows = store(base, { clock: time }).query('.house_item')
  await pass(time, 3000)
  assertEquals(await rows, [{ entity: { eid: 'a' } }])
  assertEquals(wire.paths.length, 3)
  assertEquals(wire.heard, [true, false])
})

test('a read the store refuses is not asked again', async () => {
  using wire = asked(() => ({ error: { message: 'no component house' } }), 400)
  await assertRejects(() => store(base).query('.house'), Error, 'no component')
  assertEquals(wire.paths, ['query?.house'])
})

test('a write made while the connection is away waits for who is writing', async () => {
  using wire = dropping(
    8,
    (path) =>
      path == 'me'
        ? { person: 'jo' }
        : { ok: true, aliases: {}, bundles: [{ entity: { eid: 'a' } }] },
  )
  let time = clock()
  let receipt = store(base, { clock: time }).apply({ entity: { eid: 'a' } })
  await pass(time, 120_000)
  assertEquals((await receipt).ok, true)
  assertEquals(wire.paths.filter((p) => p == 'me').length > 8, true)
  assertEquals(wire.heard, [true, false])
})
