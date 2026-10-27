// Scope tickets cannot cross stores or impersonate platform administration.
import { equal, ok, test } from '@yaks/testing'
import { ram } from '@yaks/ram'
import { capture } from '@yaks/tracker/report'
import { options, platform, store, vocab } from './core.ts'
import { sign } from './auth.ts'
import { door } from './door.ts'
import { monitor } from './monitor.ts'
import { delivery } from '@yaks/tracker/remote'
import type { Comp } from '@yaks/graph'

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

let hashIds = await (async () => {
  let g = fixture()
  let app = 'a'.repeat(40), bug = 'b'.repeat(40), error = 'c'.repeat(40)
  await g.ingest(capture(Error('historical failure'), {
    sink: () => {},
    eid: error,
    during: { app },
  }))
  await g.drain()
  await g.graph.apply([{
    entity: { eid: bug },
    bug: { fault: 'historical bug' },
  }], { trusted: true })
  let route = door(g, platform, secret)
  let auth = await sign({
    scope: platform,
    person: 'box',
    admin: true,
    ingest: true,
    mark: true,
    exp: Date.now() / 1000 + 60,
  }, secret)
  let byApp = await route(request(`/bugs?app=${app}`, auth))
  let byBug = await route(request(`/bugs?bug=${bug}`, auth))
  let archived = await route(request('/archive', auth, { bug }))
  let notified = await route(
    request('/app-errors', auth, { app, eids: [error], mark: 'notified' }),
  )
  let readError = await route(
    request(
      `/query?q=${encodeURIComponent(`.entity.eid=${error} .error *`)}`,
      auth,
    ),
  )
  return {
    g,
    app,
    bug,
    error,
    byApp: byApp.status,
    byBug: byBug.status,
    archived: archived.status,
    notified: notified.status,
    rows: await readError.json(),
  }
})()
test('tracker reads and marks preserve content-addressed global identities', async () => {
  equal([hashIds.byApp, hashIds.byBug, hashIds.archived, hashIds.notified], [
    200,
    200,
    200,
    200,
  ])
  equal(hashIds.rows[0].entity.eid, hashIds.error)
  equal((hashIds.rows[0].during as Comp).app, hashIds.app)
  let rows = await hashIds.g.graph.get([hashIds.bug, hashIds.error])
  equal(rows.every((row) => row.archived || row.notified), true)
})

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
  let marker = await sign({
    scope: space,
    person: 'scratch-person',
    mark: true,
    exp: Date.now() / 1000 + 60,
  }, secret)
  let bug = bugs[0].entity.eid
  let bare = await route(request('/resolve', marker, { bug }))
  equal([bare.status, (await g.unseen()).length], [400, 1])
  ok((await bare.json()).error.includes('resolved.cause'))
  equal(
    (await route(
      request('/resolve', marker, { bug, cause: 'a race', recur: 'no' }),
    )).status,
    200,
  )
  equal(((await g.graph.get([bug]))[0].resolved as Comp).cause, 'a race')
  equal((await g.unseen()).length, 0)
  equal(
    (await route(request('/archive', marker, { bug: bugs[0].entity.eid })))
      .status,
    200,
  )
  equal(
    (await route(
      request('/take', marker, { bug: bugs[0].entity.eid, task: 'T-7' }),
    )).status,
    200,
  )
  let [taken] = await g.graph.get([bugs[0].entity.eid], ['taken'])
  equal((taken.taken as { task?: string }).task, 'T-7')
  let box = fixture(), tenant = fixture()
  let receive = door(box, platform, secret)
  let captureRows = capture(Error('box failed'), {
    sink: () => {},
    tags: { handler: 'mail_post', source: 'box' },
  })
  let read = await ticket(platform, true)
  equal((await receive(request('/errors', read, captureRows))).status, 403)
  let intake = await sign({
    scope: platform,
    person: 'box',
    admin: true,
    ingest: true,
    exp: Date.now() / 1000 + 60,
  }, secret)
  let send = delivery(
    { url: 'https://tracker.test', secret },
    ((url, init) => receive(new Request(url, init))) as typeof fetch,
  )
  await send(captureRows)
  await send(captureRows)
  await box.drain()
  equal((await box.bugs()).length, 1)
  equal((await box.graph.read('.error *')).length, 1)
  for (
    let body of [
      [{ ...captureRows[0], bug: { hits: 999 } }],
      [{ ...captureRows[0], $delete: true }],
      [{ ...captureRows[0], during: { space } }],
      [{ ...captureRows[0], trace: {} }],
    ]
  ) equal((await receive(request('/errors', intake, body))).status, 400)
  let member = await sign({
    scope: space,
    person: 'box',
    admin: true,
    ingest: true,
    exp: Date.now() / 1000 + 60,
  }, secret)
  equal(
    (await door(tenant, space, secret)(request('/errors', member, captureRows)))
      .status,
    403,
  )
  equal((await tenant.graph.read('.error *')).length, 0)
  let app = '00000000-0000-4000-8000-000000000003'
  let occurrence = capture(Error('app failed'), {
    sink: () => {},
    during: { space, app },
  })
  await tenant.ingest(occurrence)
  let marks = door(tenant, space, secret)
  let mark = { app, eids: [occurrence[0].entity.eid], mark: 'notified' }
  equal((await marks(request('/app-errors', auth, mark))).status, 403)
  equal(
    await (await marks(request('/app-errors', member, {
      ...mark,
      app: other,
    }))).json(),
    { marked: 0 },
  )
  equal(await (await marks(request('/app-errors', member, mark))).json(), {
    marked: 1,
  })
  equal((await tenant.graph.get(mark.eids))[0].notified != null, true)
  for (let body of ['null', '{']) {
    equal(
      (await marks(
        new Request('https://tracker.test/app-errors', {
          method: 'POST',
          headers: { authorization: `Bearer ${member}` },
          body,
        }),
      )).status,
      400,
    )
  }
})

// Answering again is not a cause: the outage's bugs stay open for an agent.
let outage = fixture()
let downAt = Date.now()
await monitor(
  outage,
  downAt - 300_001,
  () => Promise.resolve(new Response(null, { status: 503 })),
  downAt,
)
await outage.drain()
let opened = (await outage.unseen()).length
let healthy = () => Promise.resolve(new Response(null, { status: 405 }))

test('uptime and heartbeat failures group, and stay open once healthy, without a yak binding', async () => {
  await monitor(outage, downAt, healthy, downAt)
  equal(
    [opened, (await outage.bugs(undefined, '.bug.status=open')).length],
    [3, 3],
  )
})

let marked = fixture()
await marked.graph.apply([{
  entity: { eid: other },
  bug: { fault: 'mark-capability', hits: 1, app: space },
}], { trusted: true })
let markDoor = door(marked, platform, secret)
let reader = await ticket(platform, true)
let intakeOnly = await sign({
  scope: platform,
  person: 'scratch-person',
  admin: true,
  ingest: true,
  exp: Date.now() / 1000 + 60,
}, secret)
let marker = await sign({
  scope: platform,
  person: 'scratch-person',
  admin: true,
  mark: true,
  exp: Date.now() / 1000 + 60,
}, secret)
let elsewhere = await sign({
  scope: space,
  person: 'scratch-person',
  mark: true,
  exp: Date.now() / 1000 + 60,
}, secret)
for (let path of ['/resolve', '/archive', '/take']) {
  for (
    let [kind, token] of [['reader', reader], ['intake', intakeOnly], [
      'other scope',
      elsewhere,
    ]]
  ) {
    test(`tracker ${path} refuses ${kind} tickets without marking bugs`, async () => {
      equal(
        (await markDoor(request(path, token, { bug: other }))).status,
        403,
      )
      let [bug] = await marked.graph.get([other], [
        'resolved',
        'archived',
        'taken',
      ])
      equal([bug.resolved, bug.archived, bug.taken], [
        undefined,
        undefined,
        undefined,
      ])
    })
  }
}
for (let path of ['/resolve', '/archive', '/take']) {
  for (
    let [kind, body] of [
      ['a long task', JSON.stringify({ bug: other, task: 'x'.repeat(101) })],
      ['null', 'null'],
      ['invalid JSON', '{'],
      ['array', '[]'],
      ['numbered id', JSON.stringify({ bug: 'B-1' })],
      ['extra fields', JSON.stringify({ bug: other, resolved: {} })],
    ]
  ) {
    test(`tracker ${path} refuses ${kind} mark bodies`, async () => {
      let response = await markDoor(
        new Request(`https://tracker.test${path}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${marker}` },
          body,
        }),
      )
      equal(response.status, 400)
    })
  }
  test(`tracker ${path} refuses missing bugs instead of creating marks`, async () => {
    equal((await markDoor(request(path, marker, { bug: space }))).status, 404)
    let [row] = await marked.graph.get([space], [
      'resolved',
      'archived',
      'taken',
    ])
    equal([row?.resolved, row?.archived, row?.taken], [
      undefined,
      undefined,
      undefined,
    ])
  })
}
test('bug marking tickets cannot submit error captures', async () => {
  equal((await markDoor(request('/errors', marker, []))).status, 403)
})
