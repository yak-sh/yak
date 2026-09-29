import { assertEquals } from '@std/assert'
import { served } from './serve.ts'

Deno.test('a served object is fenced, revalidated, and named safely', async () => {
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

Deno.test('a byte response supports seeking, revalidation, and HEAD', async () => {
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

Deno.test('a Unicode filename is a valid inline response header', () => {
  let res = served(new Uint8Array([1]), { name: '旅行—draft.mp4' })
  assertEquals(res.status, 200)
  assertEquals(
    res.headers.get('content-disposition'),
    'inline; filename="___draft.mp4"; filename*=UTF-8\'\'%E6%97%85%E8%A1%8C%E2%80%94draft.mp4',
  )
})

Deno.test('no mime means octet-stream, no name means no disposition', () => {
  let res = served(new Uint8Array())
  assertEquals(res.headers.get('content-type'), 'application/octet-stream')
  assertEquals(res.headers.get('content-disposition'), null)
})

Deno.test('immutable and private policies follow the representation', () => {
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
