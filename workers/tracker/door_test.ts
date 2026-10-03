// Scope tickets cannot cross stores or impersonate platform administration.
import { equal, test } from '@yaks/testing'
import { ram } from '@yaks/ram'
import { capture } from '@yaks/tracker/report'
import { options, platform, store, vocab } from './core.ts'
import { sign } from './auth.ts'
import { door } from './door.ts'
import { monitor } from './monitor.ts'

let space = '00000000-0000-4000-8000-000000000001'
let other = '00000000-0000-4000-8000-000000000002'
let secret = 'scratch-tracker-secret'
let fixture = () => store(ram(vocab, options), { sink: () => {} })
let ticket = (scope: string, admin = false, exp = Date.now() / 1000 + 60) =>
  sign({ scope, admin, person: 'scratch-person', exp }, secret)
let request = (path: string, token: string, body?: unknown) =>
  new Request(
    `https://tracker.test${path}`,
    {
      method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${token}` },
      ...body ? { body: JSON.stringify(body) } : {},
    },
  )

test('tracker doors fail closed for other spaces, expired tickets and nonadmins', async () => {
  let g = fixture()
  let route = door(g, space, secret)
  equal(
    (await route(request('/query?q=.error', await ticket(other)))).status,
    403,
  )
  equal(
    (await route(request('/query?q=.error', await ticket(space, false, 0))))
      .status,
    403,
  )
  equal(
    (await door(g, platform, secret)(
      request('/query?q=.error', await ticket(platform)),
    )).status,
    403,
  )
  equal(
    (await door(g, platform, secret)(
      request('/query?q=.error', await ticket(platform, true)),
    )).status,
    200,
  )
  equal(
    (await door(g, space, undefined)(
      request('/query?q=.error', await ticket(space)),
    )).status,
    403,
  )
})

test('scoped RPC reads, resolves, archives and never exposes trusted intake', async () => {
  let g = fixture()
  await g.ingest(
    capture(Error('broken'), { sink: () => {}, during: { space } }),
  )
  await g.drain()
  let route = door(g, space, secret)
  let auth = await ticket(space)
  let bugs = await (await route(request('/bugs', auth))).json()
  equal(bugs.length, 1)
  equal((await route(request('/apply', auth, []))).status, 404)
  equal((await route(request('/ingest', auth, []))).status, 404)
  equal(
    (await route(request('/resolve', auth, { bug: bugs[0].entity.eid })))
      .status,
    200,
  )
  equal((await g.unseen()).length, 0)
  equal(
    (await route(request('/archive', auth, { bug: bugs[0].entity.eid })))
      .status,
    200,
  )
})

test('uptime and heartbeat failures group and resolve without a yak binding', async () => {
  let g = fixture()
  let now = Date.now()
  await monitor(
    g,
    now - 300_001,
    async () => new Response(null, { status: 503 }),
    now,
  )
  await g.drain()
  equal((await g.unseen()).length, 2)
  await monitor(g, now, async () => new Response(null, { status: 405 }), now)
  equal((await g.unseen()).length, 0)
})
