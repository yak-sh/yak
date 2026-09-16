import { assertEquals } from '@std/assert'
import { served } from './serve.ts'

Deno.test('a served object is fenced, immutable, and named safely', async () => {
  let res = served(new Uint8Array([1, 2, 3]), {
    mime: 'image/png',
    name: 'a "shot"\r\n.png',
  })
  assertEquals(res.status, 200)
  assertEquals(res.headers.get('content-type'), 'image/png')
  assertEquals(
    res.headers.get('cache-control'),
    'public, max-age=31536000, immutable',
  )
  assertEquals(
    res.headers.get('content-security-policy'),
    "sandbox; script-src 'none'",
  )
  assertEquals(res.headers.get('x-content-type-options'), 'nosniff')
  assertEquals(
    res.headers.get('content-disposition'),
    'inline; filename="a shot.png"',
  )
  assertEquals(
    new Uint8Array(await res.arrayBuffer()),
    new Uint8Array([1, 2, 3]),
  )
})

Deno.test('no mime means octet-stream, no name means no disposition', () => {
  let res = served(new Uint8Array())
  assertEquals(res.headers.get('content-type'), 'application/octet-stream')
  assertEquals(res.headers.get('content-disposition'), null)
})
