import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { ranged, type Served, served, servedVia } from './serve.ts'

test('a served object is fenced, revalidated, and named safely', async () => {
  let res = served(new Uint8Array([1, 2, 3]), {
    mime: 'image/png',
    name: 'a "shot"\r\n.png',
  })
  assertEquals(res.status, 200)
  assertEquals(res.headers.get('content-type'), 'image/png')
  assertEquals(
    res.headers.get('cache-control'),
    'public, no-cache',
  )
  assertEquals(
    res.headers.get('content-security-policy'),
    "sandbox; script-src 'none'",
  )
  assertEquals(res.headers.get('x-content-type-options'), 'nosniff')
  assertEquals(
    res.headers.get('content-disposition'),
    'inline; filename="a shot.png"; filename*=UTF-8\'\'a%20shot.png',
  )
  assertEquals(
    new Uint8Array(await res.arrayBuffer()),
    new Uint8Array([1, 2, 3]),
  )
})

test('a byte response supports seeking, revalidation, and HEAD', async () => {
  let bytes = new Uint8Array([0, 1, 2, 3, 4, 5])
  let at = 'https://blob.invalid/movie.mp4'
  let serve = (method: string, headers: HeadersInit = {}) =>
    served(
      bytes,
      { mime: 'video/mp4', etag: '"v1"' },
      new Request(at, { method, headers }),
    )
  assertEquals(
    serve('GET').headers.get('content-security-policy'),
    "script-src 'none'",
  )
  for (
    let [range, part, span] of [
      ['bytes=2-4', [2, 3, 4], 'bytes 2-4/6'],
      ['bytes=4-', [4, 5], 'bytes 4-5/6'],
      ['bytes=-2', [4, 5], 'bytes 4-5/6'],
    ] as const
  ) {
    let res = serve('GET', { range })
    assertEquals(res.status, 206)
    assertEquals(res.headers.get('content-range'), span)
    assertEquals(res.headers.get('content-length'), String(part.length))
    assertEquals(res.headers.get('accept-ranges'), 'bytes')
    assertEquals(
      new Uint8Array(await res.arrayBuffer()),
      new Uint8Array(part),
    )
  }
  let beyond = serve('GET', { range: 'bytes=6-' })
  assertEquals(beyond.status, 416)
  assertEquals(beyond.headers.get('content-range'), 'bytes */6')
  assertEquals(await beyond.text(), '')
  let stale = serve('GET', { range: 'bytes=2-', 'if-range': '"old"' })
  assertEquals(stale.status, 200)
  assertEquals([...new Uint8Array(await stale.arrayBuffer())], [...bytes])
  let fresh = serve('GET', { range: 'bytes=2-', 'if-range': '"v1"' })
  assertEquals(fresh.status, 206)
  let unchanged = serve('GET', { 'if-none-match': '"v1"', range: 'bytes=2-' })
  assertEquals(unchanged.status, 304)
  let head = serve('HEAD', { range: 'bytes=2-' })
  assertEquals(head.status, 200)
  assertEquals(head.headers.get('content-length'), '6')
  await head.body?.cancel()
})

test('a Unicode filename is a valid inline response header', () => {
  let res = served(new Uint8Array([1]), { name: '旅行—draft.mp4' })
  assertEquals(res.status, 200)
  assertEquals(
    res.headers.get('content-disposition'),
    'inline; filename="___draft.mp4"; filename*=UTF-8\'\'%E6%97%85%E8%A1%8C%E2%80%94draft.mp4',
  )
})

test('no mime means octet-stream, no name means no disposition', () => {
  let res = served(new Uint8Array())
  assertEquals(res.headers.get('content-type'), 'application/octet-stream')
  assertEquals(res.headers.get('content-disposition'), null)
})

let cachedBytes = (() => {
  let body = new Uint8Array([0, 1, 2, 3, 4, 5])
  let calls: Request[] = []
  let cached = new Map<string, Response[]>()
  let key = (request: Request) =>
    `${request.method}:${request.headers.get('range') ?? ''}`
  let read = (request: Request) => {
    calls.push(request)
    return Promise.resolve(
      cached.get(key(request))?.shift() ?? new Response(null, { status: 404 }),
    )
  }
  let meta: Served = {
    mime: 'video/mp4',
    name: 'theme.mp4',
    etag: '"representation"',
    cache: 'revalidate',
  }
  let at = 'https://blob.invalid/movie.mp4'
  let request = (headers: HeadersInit = {}, method = 'GET') =>
    new Request(at, { method, headers })
  let requests = {
    whole: request(),
    part: request({ range: 'bytes=2-4', 'if-range': '"representation"' }),
    stale: request({ range: 'bytes=2-', 'if-range': '"old"' }),
    fresh: request({ 'if-none-match': '"representation"' }),
    beyond: request({ range: 'bytes=6-' }),
    head: request({}, 'HEAD'),
  }
  // The cached backend responses already exist when the response fence is
  // called. Select by what it actually forwards, so a wrong range or method
  // cannot receive the response the caller expected.
  for (
    let req of [
      request(),
      request({ range: 'bytes=2-4' }),
      request(),
      request({ range: 'bytes=6-' }),
      request({}, 'HEAD'),
    ]
  ) {
    let response = ranged(body, req, {
      'content-type': 'application/octet-stream',
      'cache-control': 'public, max-age=31536000',
      etag: '"bytes"',
    })
    let responses = cached.get(key(req)) ?? []
    responses.push(response)
    cached.set(key(req), responses)
  }
  let get = (name: keyof typeof requests) =>
    servedVia(read, meta, requests[name])
  return { body, calls, get }
})()

test('cached bytes keep range and condition semantics under the response fence', async () => {
  let { body, calls, get } = cachedBytes
  let whole = await get('whole')
  assertEquals(whole.status, 200)
  assertEquals(whole.headers.get('content-type'), 'video/mp4')
  assertEquals(whole.headers.get('cache-control'), 'private, no-cache')
  assertEquals(whole.headers.get('etag'), '"representation"')
  assertEquals(new Uint8Array(await whole.arrayBuffer()), body)

  let part = await get('part')
  assertEquals(part.status, 206)
  assertEquals(part.headers.get('content-range'), 'bytes 2-4/6')
  assertEquals(new Uint8Array(await part.arrayBuffer()), body.slice(2, 5))
  assertEquals(calls.at(-1)?.headers.get('range'), 'bytes=2-4')

  let stale = await get('stale')
  assertEquals(stale.status, 200)
  assertEquals(calls.at(-1)?.headers.get('range'), null)
  assertEquals(new Uint8Array(await stale.arrayBuffer()), body)

  let before = calls.length
  let fresh = await get('fresh')
  assertEquals(fresh.status, 304)
  assertEquals(calls.length, before)

  let beyond = await get('beyond')
  assertEquals(beyond.status, 416)
  assertEquals(beyond.headers.get('content-range'), 'bytes */6')

  let head = await get('head')
  assertEquals(head.status, 200)
  assertEquals(head.headers.get('content-length'), '6')
  assertEquals(await head.text(), '')
})

test('immutable and private policies follow the representation', () => {
  let bytes = new Uint8Array([1, 2, 3])
  let immutable = served(bytes, { mime: 'image/png', cache: 'immutable' })
  assertEquals(
    immutable.headers.get('cache-control'),
    'public, max-age=31536000, immutable',
  )
  let private_ = served(bytes, { mime: 'image/png', cache: 'private' })
  assertEquals(private_.headers.get('cache-control'), 'private, no-store')
  let revalidate = served(bytes, { cache: 'revalidate' })
  assertEquals(revalidate.headers.get('cache-control'), 'private, no-cache')
})
