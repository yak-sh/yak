import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { fromApp } from './outbound.ts'
import { platform } from './testing.ts'
import { KERNEL, meta } from './meta.ts'
import { source } from '@yaks/workerd/rate'
import { Outbound } from './index.ts'
import type { Caller } from '@yaks/egress'

let keys: string[] = []
let p = platform('app-source-check', {
  REGISTER_RATE: {
    limit: ({ key }) => {
      keys.push(key)
      return Promise.resolve({ success: false })
    },
  },
})

let store = meta(p.env)
let custom = 'source.example'
await store.apply([
  { entity: { eid: '$space' }, space: { slug: 'source', store: 'source.1' } },
  {
    entity: { eid: '$app' },
    app: { slug: 'notes', space: '$space', store: 'source/notes.1' },
  },
  {
    entity: { eid: '$host' },
    hostname: { name: custom, serves: '$app', stage: 'active' },
  },
], KERNEL)

test('a worker call to a custom domain keeps its request and uses its app as source', async () => {
  let app = crypto.randomUUID()
  let req = new Request(`https://${custom}/api/query?q=hello`, {
    method: 'POST',
    headers: { 'cf-connecting-ip': '198.51.100.3', 'x-example': 'kept' },
    body: 'a request',
  })
  let res = await fromApp(
    req,
    p.env,
    { app, level: null, person: null },
    async (asked) =>
      Response.json({
        source: source(asked),
        url: asked.url,
        method: asked.method,
        header: asked.headers.get('x-example'),
        body: await asked.text(),
      }),
  )
  assertEquals(await res.json(), {
    source: app,
    url: req.url,
    method: 'POST',
    header: 'kept',
    body: 'a request',
  })
})

let worker = new Outbound({}, p.env) as unknown as {
  send(req: Request, caller: Caller): Promise<Response>
}
let caller: Caller = {
  app: crypto.randomUUID(),
  level: null,
  person: null,
}

for (let ip of [null, '198.51.100.1', '198.51.100.2']) {
  test(`an app's registration call is limited by its eid with source ${ip}`, async () => {
    let req = new Request('https://yaks.app/oauth/register', {
      method: 'POST',
      headers: ip ? { 'cf-connecting-ip': ip } : {},
    })
    let res = await worker.send(req, caller)
    assertEquals(res.status, 429)
    assertEquals(keys.at(-1), caller.app)
    assertEquals((await res.json()).error, 'too_many_requests')
  })
}
