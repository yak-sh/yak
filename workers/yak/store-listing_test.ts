import { aside, keep } from '@yaks/api/log'
import { driver } from '@yaks/durable-object'
import { mint } from '@yaks/graph'
import { equal, test } from '@yaks/testing'
import { ACROSS, BRANCH, WAKE } from './door.ts'
import { Store } from './graph.ts'
import { state } from './testing.ts'

let name = 'ada/cookbook'
let listing = '/query?listing=1&q=.recipe%26%3Fdoc'
let manifest = {
  $defs: { recipe: { component: true, properties: {} } },
}
let testVersion = (id: string) => ({ CF_VERSION_METADATA: { id } })

let cookbook = async (access = 'public') => {
  let ctx = state(name)
  let app = mint(), person = mint()
  let row = { entity: { eid: mint() }, recipe: {}, doc: { title: 'Cake' } }
  let owner = { 'x-yak-person': person, 'x-yak-role': 'owner' }
  let vouch = {
    'x-store': name,
    'x-yak-app': app,
    'x-yak-access': access,
    'x-yak-policy': '2',
    'x-yak-release': '1',
  }
  let request = (path: string, headers = {}, body?: unknown) =>
    new Request('http://store' + path, {
      headers: { ...vouch, ...headers },
      ...(body == null ? {} : { method: 'POST', body: JSON.stringify(body) }),
    })
  let version = testVersion('listing')
  let full = new Store(ctx, version)
  equal((await full.fetch(request('/vocab', owner, manifest))).status, 200)
  equal((await full.fetch(request('/apply', owner, [row]))).status, 200)
  let expected = await (await full.fetch(request(listing, owner))).text()
  await ctx.settled()
  let open = (bindings = version) => new Store(ctx, bindings)
  let wake = () =>
    new Request('http://store' + WAKE, {
      headers: { 'x-store': name, 'x-yak-kernel': '1' },
    })
  return { ctx, open, wake, request, row, expected, owner, person }
}

let read = async (answer: Response) =>
  [
    answer.status,
    answer.headers.has('x-yak-wake'),
    await answer.text(),
  ] as const

test('a page wake and its listing use the fitted reader together', async () => {
  let { ctx, open, wake, request, expected, owner } = await cookbook()
  using _db = ctx.storage
  let store = open()
  let [woken, listed] = await Promise.all([
    store.fetch(wake()),
    store.fetch(request(listing, { ...owner, [ACROSS]: '1' })),
  ])
  equal(await read(woken), [204, false, ''])
  equal(await read(listed), [200, false, expected])
  let write = await store.fetch(request('/apply', owner, [{
    entity: { eid: mint() },
    recipe: {},
    doc: { title: 'Toast' },
  }]))
  equal([write.status, write.headers.has('x-yak-wake')], [200, true])
  await ctx.settled()
})

test('a fitted private listing checks fresh standing and keeps its policy floor', async () => {
  let { ctx, open, request, expected, owner, person } = await cookbook(
    'private',
  )
  using _db = ctx.storage
  let store = open()
  equal((await read(await store.fetch(request(listing)))).slice(0, 2), [
    401,
    false,
  ])
  equal(
    await read(
      await store.fetch(request(listing, {
        ...owner,
        'x-yak-policy': '3',
      })),
    ),
    [200, false, expected],
  )
  // The mirrored owner grant is still in the file. The new vouch withdrew it.
  equal(
    (await read(
      await store.fetch(request(listing, {
        'x-yak-person': person,
        'x-yak-policy': '4',
      })),
    )).slice(0, 2),
    [403, false],
  )
  equal((await open().fetch(request(listing, owner))).status, 503)
  await ctx.settled()
})

test('a moved schema, branch, named read and new access use the full Store', async () => {
  let { ctx, open, request, expected } = await cookbook()
  using _db = ctx.storage
  let results = [
    await read(await open(testVersion('next')).fetch(request(listing))),
    await read(
      await open(testVersion('next')).fetch(
        request(listing, { [BRANCH]: '1' }),
      ),
    ),
    await read(
      await open(testVersion('next')).fetch(request(listing + '&names=1')),
    ),
    await read(
      await open(testVersion('next')).fetch(request(listing, {
        'x-yak-access': 'private',
        'x-yak-policy': '3',
      })),
    ),
  ]
  equal(results.map(([status, started]) => [status, started]), [
    [200, true],
    [400, false],
    [200, true],
    [401, true],
  ])
  equal(results[0][2], expected)
  equal(JSON.parse(results[1][2]).message, 'no branch 1')
  equal(results[2][2], expected)
  await ctx.settled()
})

test('a page wake recovers waiting and set-aside writes before a listing', async () => {
  let { ctx, open, wake, request, owner } = await cookbook()
  using _db = ctx.storage
  let sql = driver(ctx.storage)
  let queue = (title: string) => {
    let rows = [{ entity: { eid: mint() }, recipe: {}, doc: { title } }]
    return keep(sql, request('/apply', owner, rows), JSON.stringify(rows))
  }
  queue('Waiting')
  aside(sql, queue('Set aside'), 'the previous incarnation failed')
  let store = open()
  equal((await read(await store.fetch(wake()))).slice(0, 2), [204, true])
  let answer = await store.fetch(request(listing))
  let rows = await answer.json() as { doc: { title: string } }[]
  equal(rows.map((b) => b.doc.title).sort(), ['Cake', 'Set aside', 'Waiting'])
  await ctx.settled()
})

test('a fitted reader restores an earlier wake alongside an existing alarm', async () => {
  let { ctx, open, owner, request, row, wake } = await cookbook()
  using _db = ctx.storage
  let at = Date.now() + 60_000
  let written = await open().fetch(request('/apply', owner, [{
    entity: { eid: mint() },
    wake: { at: new Date(at).toISOString(), target: row.entity.eid },
  }]))
  equal(written.status, 200)
  await ctx.settled()
  await ctx.storage.setAlarm(at + 60_000)

  equal((await read(await open().fetch(wake()))).slice(0, 2), [204, false])
  await ctx.settled()
  equal(await ctx.storage.getAlarm(), at)
})
