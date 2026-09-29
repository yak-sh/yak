// The app gateway decides who may read before asking Files for cached bytes.
// The versioned representation, conditions and seeks all use that one door.
import { assertEquals } from '@std/assert'
import * as apps from './apps.ts'
import * as files from './files.ts'
import { ADA, as, platform, seeded, visit } from './serving-probe.ts'

Deno.test('private app blobs keep the cache behind authorization', async () => {
  using scenario = platform()
  let { env } = scenario
  await seeded(env, 'private')
  let cookie = await as(ADA)
  let body = new Uint8Array([0, 1, 2, 3, 4, 5])
  let upload = await apps.fetch(
    visit('/cookbook/api/blob', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/octet-stream' },
      body,
    }),
    env,
  )
  assertEquals(upload.status, 200)
  let file: { url: string } = await upload.json()
  let calls: Request[] = []
  env.FILES = {
    fetch: (req) => {
      calls.push(req)
      return files.fetch(req, env)
    },
  }
  let get = (headers: Record<string, string> = {}, method = 'GET') =>
    apps.fetch(
      visit(file.url, { method, headers: { cookie, ...headers } }),
      env,
    )

  let stranger = await apps.fetch(visit(file.url), env)
  assertEquals(stranger.status, 401)
  assertEquals(calls.length, 0)

  let whole = await get()
  assertEquals(whole.status, 200)
  assertEquals(whole.headers.get('cache-control'), 'private, no-store')
  let etag = whole.headers.get('etag')!
  assertEquals(new Uint8Array(await whole.arrayBuffer()), body)
  assertEquals(calls.length, 1)

  let part = await get({ range: 'bytes=2-4', 'if-range': etag })
  assertEquals(part.status, 206)
  assertEquals(part.headers.get('content-range'), 'bytes 2-4/6')
  assertEquals(new Uint8Array(await part.arrayBuffer()), body.slice(2, 5))
  assertEquals(calls[1].url, calls[0].url)
  assertEquals(calls[1].headers.get('range'), 'bytes=2-4')

  let fresh = await get({ 'if-none-match': etag })
  assertEquals(fresh.status, 304)
  assertEquals(calls.length, 2)

  let stale = await get({ range: 'bytes=2-', 'if-range': '"old"' })
  assertEquals(stale.status, 200)
  assertEquals(calls[2].headers.get('range'), null)
  assertEquals(new Uint8Array(await stale.arrayBuffer()), body)

  let head = await get({}, 'HEAD')
  assertEquals(head.status, 200)
  assertEquals(head.headers.get('content-length'), '6')
  assertEquals(await head.text(), '')
})
