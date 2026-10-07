/** The remote door authenticates, bounds reads and never follows a redirect
 * carrying a platform ticket. The Worker itself opens the shared ticket. */
import { equal, ok, test } from '@yaks/testing'
import { derivedEid } from '@yaks/graph'
import { authorize } from '../../workers/tracker/auth.ts'
import { routes } from './routes.ts'
import { sign } from './ticket.ts'
let secret = 'test-only-tracker-secret'
let id = '00000000-0000-4000-8000-000000000001'
test('remote trace doors preserve pages and use a platform-admin ticket the Worker accepts', async () => {
  let calls: string[] = []
  let options = { remote: { url: 'http://127.0.0.1:18081', secret } }
  let door = routes(
    {},
    options,
    (async (url, init) => {
      let req = new Request(url, init), u = new URL(req.url)
      let scope = u.searchParams.get('scope')!
      let access = await authorize(
        req,
        options.remote.secret,
        scope == 'platform' ? derivedEid('tracker|platform') : scope,
      )
      ok(access)
      equal(access.admin, true)
      equal(init?.redirect, 'error')
      calls.push(u.pathname + u.search)
      return Response.json({ rows: [{ entity: { eid: id } }], next: id })
    }) as typeof fetch,
  )
  let request = (path: string) => new Request(`http://box/tracker/${path}`)
  let r = await door[0].handle(request(`traces?after=${id}&limit=2`))
  equal(await r.json(), { rows: [{ entity: { eid: id } }], next: id })
  equal(r.headers.get('cache-control'), 'no-store')
  equal(calls, [`/traces?scope=platform&limit=2&after=${id}`])
  equal((await door[0].handle(request('traces?limit=101'))).status, 400)
  equal((await door[1].handle(request('trace'))).status, 400)
  equal((await door[0].handle(request('traces?scope=other'))).status, 400)
  options.remote.secret = 'rotated-test-only'
  equal((await door[0].handle(request(`traces?scope=${id}`))).status, 200)
  equal(calls.length, 2)
})
test('remote failures are explicit and contain no upstream body, URL, ticket or secret', async () => {
  let req = new Request('http://box/tracker/traces')
  equal((await routes({})[0].handle(req)).status, 503)
  equal(
    (await routes({}, { remote: { url: 'https://tracker.invalid' } })[0].handle(
      req,
    )).status,
    503,
  )
  let door = routes(
    {},
    { remote: { url: 'https://tracker.invalid', secret } },
    (async () => new Response(secret, { status: 403 })) as typeof fetch,
  )[0]
  let r = await door.handle(req)
  equal(r.status, 502)
  ok(!(await r.text()).includes(secret))
  let ticket = await sign({
    scope: derivedEid('tracker|platform'),
    person: 'box',
    exp: Date.now() / 1000 + 60,
  }, secret)
  equal(
    await authorize(
      new Request('http://worker', {
        headers: { authorization: `Bearer ${ticket}` },
      }),
      secret,
      derivedEid('tracker|platform'),
    ),
    null,
  )
})
