import { clock, test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import {
  anonymousPage,
  EPOCH,
  publicDirectory,
  type ServingCopyDoor,
} from './directory-copy.ts'
import { ServingCopy } from './serving-copy.ts'
import { directory } from './directory.ts'

let fixture = () => {
  let state = new ServingCopy({
    persistence: { read: () => undefined, write: () => {} },
  })
  let reads = 0, fills: Promise<boolean>[] = []
  let copy: ServingCopyDoor = {
    begin: () => Promise.resolve(state.begin()),
    finish: (n) => Promise.resolve(state.finish(n)),
    get: (k) => {
      reads++
      return Promise.resolve().then(() => state.get(k))
    },
    put: (n, k, b) => {
      let out = Promise.resolve(state.put(n, k, b))
      fills.push(out)
      return out
    },
  }
  return { state, copy, reads: () => reads, fills }
}
let req = () => new Request('https://directory/query?q=page')
let flush = async () => {
  for (let n = 0; n < 12; n++) await Promise.resolve()
}

let warmRead = await (async () => {
  let f = fixture(), time = clock()
  let door = publicDirectory(
    { fetch: () => Promise.resolve(new Response('current')) },
    f.copy,
    time,
  )
  return { body: await (await door.fetch(req())).text(), reads: f.reads() }
})()
test('directory deadline: no copy hop on a warm authoritative request', () => {
  assertEquals(warmRead, { body: 'current', reads: 0 })
})
test('directory deadline: stale answer is used at 25ms, never before', async () => {
  let f = fixture(), time = clock()
  f.state.put(0, 'page', 'public')
  let door = publicDirectory(
    { fetch: () => new Promise(() => {}) },
    f.copy,
    time,
  )
  let got: string | null = null
  let done = door.fetch(req()).then(async (r) => {
    got = await r.text()
  })
  await time.advance(24)
  assertEquals(got, null)
  await time.advance(1)
  await done
  assertEquals(got, 'public')
  assertEquals(door.stale, true)
})
test('directory deadline: cold and fenced copies do not shorten authoritative wait', async () => {
  for (let blocked of [false, true]) {
    let f = fixture(), time = clock()
    if (blocked) f.state.begin()
    let resolve!: (r: Response) => void
    let door = publicDirectory(
      { fetch: () => new Promise((r) => resolve = r) },
      f.copy,
      time,
    )
    let got = false,
      done = door.fetch(req()).then(() => {
        got = true
      })
    await time.advance(25)
    await flush()
    assertEquals(got, false)
    resolve(new Response('authoritative'))
    await done
    assertEquals(got, true)
  }
})
test('directory deadline: a late directory result cannot refill a fenced revision', async () => {
  let f = fixture(), time = clock(), resolve!: (r: Response) => void
  let door = publicDirectory(
    { fetch: () => new Promise((r) => resolve = r) },
    f.copy,
    time,
  )
  let done = door.fetch(req())
  let revision = f.state.begin()
  f.state.finish(revision)
  resolve(new Response('old', { headers: { [EPOCH]: '0' } }))
  await done
  await flush()
  assertEquals(f.state.put(0, 'page', 'old'), false)
})
test('directory deadline: writes and credentials never gain a stale read', async () => {
  for (
    let init of [
      { method: 'POST' },
      { headers: { cookie: 'yak_session=person' } },
      { headers: { authorization: 'Bearer person' } },
      { headers: { upgrade: 'websocket' } },
    ] as RequestInit[]
  ) {
    assertEquals(
      anonymousPage(new Request('https://ada.yaks.app/app/', init)),
      false,
    )
  }
  assertEquals(
    anonymousPage(new Request('https://ada.yaks.app/app/api/query')),
    false,
  )
  assertEquals(anonymousPage(new Request('https://ada.yaks.app/app/')), true)
  let f = fixture(), time = clock(), got = false
  let door = publicDirectory(
    { fetch: () => new Promise(() => {}) },
    f.copy,
    time,
  )
  void door.fetch(new Request('https://directory/apply', { method: 'POST' }))
    .then(() => {
      got = true
    })
  await time.advance(100)
  assertEquals(got, false)
  assertEquals(f.reads(), 0)
})

// A signature is not needed for this conservative exclusion: only a possible
// person is sent to authority; browser-only payloads never lend standing.
let encoded = (value: unknown) => btoa(JSON.stringify(value)) + '.mac'
test('directory deadline: a browser seal is anonymous but a person seal is not', () => {
  let page = (value: unknown) =>
    new Request('https://ada.yaks.app/app/', {
      headers: { cookie: `yak_session=${encoded(value)}` },
    })
  assertEquals(anonymousPage(page({ via: 'browser', exp: 42 })), true)
  assertEquals(
    anonymousPage(page({ person: 'ada', space: null, exp: 42 })),
    false,
  )
})

// Once authority won, a copy already in flight must not taint its page.
let directWinner = await (async () => {
  let time = clock(), used = 0
  let direct = Promise.withResolvers<Response>()
  let copy = Promise.withResolvers<string | null>()
  let f = fixture()
  let door = publicDirectory(
    { fetch: () => direct.promise },
    { ...f.copy, get: () => copy.promise },
    time,
    () => {
      used++
    },
  )
  let reading = door.fetch(req())
  await time.advance(25)
  direct.resolve(new Response('authority'))
  let answer = await reading
  copy.resolve('late copy')
  await flush()
  return { body: await answer.text(), stale: !!door.stale, used }
})()
test('directory deadline: a late copy cannot make an authoritative winner uncacheable', () => {
  assertEquals(directWinner, { body: 'authority', stale: false, used: 0 })
})

// The Store independently validates this revision; the public transport only
// preserves the stamp attached to these exact bytes, without a valid RPC.
let publicPolicies = await (async () => {
  let row = {
    entity: { eid: 'page' },
    app: { slug: 'page', space: 'space', access: 'public' },
  }
  let f = fixture(), time = clock(), validations = 0
  f.copy.valid = () => {
    validations++
    return Promise.resolve(true)
  }
  let direct = publicDirectory(
    {
      fetch: () =>
        Promise.resolve(Response.json([row], {
          headers: { [EPOCH]: '7' },
        })),
    },
    f.copy,
    time,
  )
  let current = await directory(direct, true).app(
    { eid: 'space', slug: 'space' } as never,
    'page',
  )
  f.copy.read = () =>
    Promise.resolve({ revision: 8, body: JSON.stringify([row]) })
  let copied = directory(
    publicDirectory({ fetch: () => new Promise(() => {}) }, f.copy, time),
    true,
  )
    .app({ eid: 'space', slug: 'space' } as never, 'page')
  await time.advance(25)
  let held = await copied
  delete f.copy.read
  let legacy = directory(
    publicDirectory({ fetch: () => new Promise(() => {}) }, {
      ...f.copy,
      get: () => Promise.resolve(JSON.stringify([row])),
    }, time),
    true,
  ).app({ eid: 'space', slug: 'space' } as never, 'page')
  await time.advance(25)
  return {
    current: current?.policy,
    copied: held?.policy,
    legacy: (await legacy)?.policy,
    reads: f.reads(),
    validations,
  }
})()
test('public directory stamps current and copied Apps but never invents legacy authority', () => {
  assertEquals(publicPolicies, {
    current: 7,
    copied: 8,
    legacy: undefined,
    reads: 0,
    validations: 0,
  })
})
