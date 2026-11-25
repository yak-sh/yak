// The public client asks a read once however many callers want it at the
// same moment, and each caller still holds its own answer; a subscription's
// first rows are a promise a page can wait on.
import { assertEquals, assertNotStrictEquals, assertRejects } from '@std/assert'
import { type Clock, clock, test } from '@yaks/testing'
import { store } from '@yaks/platform/client'

let base = 'https://reads-client.test/house/api/'
let asked = (
  answer: (path: string) => unknown,
  status = 200,
) => {
  let paths: string[] = []
  let events = new EventTarget()
  let fetch = async (url: URL) => {
    let path = String(url).slice(base.length)
    paths.push(path)
    return Response.json(await answer(path), { status })
  }
  // A socket that never opens, so a subscription's rows come over HTTP.
  let connect = () =>
    ({ readyState: 0, send() {}, close() {} }) as unknown as WebSocket
  return {
    paths,
    events,
    client: (clock?: Clock) => store(base, { clock, fetch, events, connect }),
  }
}

test('reads asked together are one request, each caller its own rows', async () => {
  let wire = asked((path) =>
    path == 'who' ? { person: 'jo' } : [{ entity: { eid: path } }]
  )
  let client = wire.client()
  let [one, two] = await Promise.all([client.me(), client.me()])
  let [rows, same, other] = await Promise.all([
    client.query('.house_item'),
    client.query('.house_item'),
    client.query('.house_file'),
  ])
  assertEquals(wire.paths, ['who', 'query?.house_item', 'query?.house_file'])
  assertEquals([one, two], [{ person: 'jo' }, { person: 'jo' }])
  assertNotStrictEquals(one, two)
  assertEquals(rows, same)
  assertNotStrictEquals(rows, same)
  assertEquals(other, [{ entity: { eid: 'query?.house_file' } }])
})

test('a read asked again after its answer is asked again', async () => {
  let wire = asked(() => ({ person: 'jo' }))
  let client = wire.client()
  await client.me()
  await client.me()
  assertEquals(wire.paths, ['who', 'who'])
})

test('a read on its way when a write lands answers nobody who asks after', async () => {
  let open = () => {}
  let gate = new Promise<void>((on) => open = on)
  let wire = asked(async (path) => {
    if (path == 'query?.house_item' && wire.paths.length == 1) await gate
    return path == 'query?.house_item' ? [] : { path }
  })
  let client = wire.client()
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
  let wire = asked(() => [{ entity: { eid: 'a' } }])
  let heard: unknown[] = []
  let live = wire.client().subscribe(
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
  let wire = asked(() => ({ error: { message: 'no component house' } }), 400)
  let live = wire.client().subscribe('.house', () => {})
  await assertRejects(() => live.ready, Error, 'no component house')
  live()
})

// A connection that is away for the first `drops` reads of each path, then
// answers; what the page heard of it is `yak-reconnecting`'s details.
let dropping = (drops: number, answer: (path: string) => unknown) => {
  let missed = new Map<string, number>()
  let heard: boolean[] = []
  let wire = asked((path) => {
    let n = missed.get(path) ?? 0
    missed.set(path, n + 1)
    if (n < drops && path != 'apply') throw new TypeError('Failed to fetch')
    return answer(path)
  })
  wire.events.addEventListener(
    'yak-reconnecting',
    (e) => heard.push((e as CustomEvent).detail),
  )
  return { ...wire, heard }
}

// Time passes in steps, so a retry a wait sets off sets its next wait in time.
let pass = async (time: ReturnType<typeof clock>, ms: number) => {
  for (let t = 0; t < ms; t += 500) await time.advance(500)
}

test('a read with no answer is asked again, and the page hears it reconnect', async () => {
  let wire = dropping(2, () => [{ entity: { eid: 'a' } }])
  let other = dropping(1, () => ({ person: 'jo' }))
  let time = clock()
  let rows = wire.client(time).query('.house_item')
  let person = other.client(time).me()
  await time.advance(1000)
  assertEquals(await person, { person: 'jo' })
  assertEquals(other.heard, [true, false])
  assertEquals(wire.heard, [true])
  await pass(time, 2000)
  assertEquals(await rows, [{ entity: { eid: 'a' } }])
  assertEquals(wire.paths.length, 3)
  assertEquals(wire.heard, [true, false])
})

test('a read the store refuses is not asked again', async () => {
  let wire = asked(() => ({ error: { message: 'no component house' } }), 400)
  await assertRejects(
    () => wire.client().query('.house'),
    Error,
    'no component',
  )
  assertEquals(wire.paths, ['query?.house'])
})

test('a write made while the connection is away waits for who is writing', async () => {
  let wire = dropping(
    8,
    (path) =>
      path == 'who'
        ? { person: 'jo' }
        : { ok: true, aliases: {}, bundles: [{ entity: { eid: 'a' } }] },
  )
  let time = clock()
  let receipt = wire.client(time).apply({ entity: { eid: 'a' } })
  await pass(time, 120_000)
  assertEquals((await receipt).ok, true)
  assertEquals(wire.paths.filter((p) => p == 'who').length > 8, true)
  assertEquals(wire.heard, [true, false])
})

test('a watch a stopped store refused is declared again after the wait it asked', async () => {
  let sent: { subscribe?: string; id?: string }[] = []
  let sock: { onmessage?: (e: { data: string }) => void } = {}
  let connect = () =>
    Object.assign(sock, {
      readyState: 1,
      send: (frame: string) => void sent.push(JSON.parse(frame)),
      close() {},
    }) as unknown as WebSocket
  let time = clock()
  let live = store(base, {
    clock: time,
    connect,
    fetch: () => new Promise(() => {}),
    events: new EventTarget(),
  }).subscribe('.house_item', () => {})
  let [{ id, subscribe }] = sent
  sock.onmessage!({
    data: JSON.stringify({
      id,
      refused: { error: 'Stopped', retry: { after: 5_000 } },
    }),
  })
  await time.advance(4_999)
  assertEquals(sent.length, 1)
  await time.advance(1)
  assertEquals(sent, [{ subscribe, id }, { subscribe, id }])
  live()
})

test('a store that moved is watched from a new socket at once, and only its own', () => {
  type Sock = { sent: unknown[]; closed: boolean; onopen?: () => void }
  let opened: Sock[] = []
  let connect = () => {
    let s: Sock & Record<string, unknown> = {
      readyState: 1,
      sent: [],
      closed: false,
      send: (frame: string) => void s.sent.push(JSON.parse(frame)),
      close: () => void (s.closed = true),
    }
    opened.push(s)
    return s as unknown as WebSocket
  }
  let events = new EventTarget()
  let live = store('https://moved-client.test/house/api/', {
    connect,
    fetch: () => new Promise(() => {}),
    events,
  }).subscribe(
    '.house_item',
    () => {},
  )
  let moved = (url: string) =>
    events.dispatchEvent(new CustomEvent('yak-moved', { detail: url }))
  moved('https://moved-client.test/garden/request')
  assertEquals(opened.length, 1)
  moved('https://moved-client.test/house/request')
  assertEquals(opened.map((s) => s.closed), [true, false])
  let [first, second] = opened
  second.onopen!()
  assertEquals(second.sent, first.sent)
  live()
})
