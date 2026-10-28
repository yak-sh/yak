/** The remote door authenticates, bounds reads and never follows a redirect
 * carrying a platform ticket. The Worker itself opens the shared ticket. */
import { equal, ok, test } from '@yaks/testing'
import { derivedEid } from '@yaks/graph'
import { authorize } from '../../workers/tracker/auth.ts'
import { routes } from './routes.ts'
import { sign } from './ticket.ts'
let secret = 'test-only-tracker-secret'
let id = '00000000-0000-4000-8000-000000000001'
let nonAdmin = await sign({
  scope: derivedEid('tracker|platform'),
  person: 'box',
  exp: Date.now() / 1000 + 60,
}, secret)
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
      equal(access?.admin, true)
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
// What the box's door answers where the remote is unconfigured, has no
// secret, or answers each status: a refusal of what was asked is 502, and a
// tracker that cannot answer for now 503.
let door = (remote?: { url: string; secret?: string }, status = 200) =>
  routes(
    {},
    { remote },
    (() => Promise.resolve(new Response(secret, { status }))) as typeof fetch,
  )[0].handle(new Request('http://box/tracker/traces'))
let failures = await Promise.all([
  door(),
  door({ url: 'https://tracker.invalid' }),
  ...[403, 429, 500, 503].map((status) =>
    door({ url: 'https://tracker.invalid', secret }, status)
  ),
])
let bodies = await Promise.all(failures.map((r) => r.text()))
let nonAdminAccess = await authorize(
  new Request('http://worker', {
    headers: { authorization: `Bearer ${nonAdmin}` },
  }),
  secret,
  derivedEid('tracker|platform'),
)
test('remote failures are explicit and contain no upstream body, URL, ticket or secret', () => {
  equal(failures.map((r) => r.status), [503, 503, 502, 503, 503, 503])
  ok(!bodies.some((body) => body.includes(secret)))
  equal(nonAdminAccess, null)
})
