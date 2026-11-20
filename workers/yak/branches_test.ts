// An app store's branches through its kernel doors: its first branch turns
// its versions on, a branch reads main as of its fork under its own writes,
// and a later incarnation composes the versions its data requires.
import { equal, ok, test } from '@yaks/testing'
import { requirements } from '@yaks/sqlite'
import { driver } from '@yaks/durable-object'
import { ownedBy } from './directory-fixture.ts'
import { directory, fetch as directoryFetch, storeName } from './directory.ts'
import { storeOf } from './door.ts'
import { KERNEL } from './meta.ts'
import { Store } from './graph.ts'
import { declared, platform } from './testing.ts'

let p = platform('branch probe')
let dir = directory({ fetch: (r) => directoryFetch(r, p.env) })
let space = await ownedBy(dir, 'branch-owner', 'branching')
await dir.apply({
  entities: [{
    entity: { eid: '$app' },
    app: {
      slug: 'drafts',
      version: 1,
      space: space.eid,
      store: 'branching/drafts.123456',
      access: 'public',
    },
    doc: { title: 'Drafts' },
  }],
})
let app = (await dir.app(space, 'drafts'))!
await declared(p.env, space, app)
let name = storeName(space, app)
let ask = storeOf(p.env.STORE, name, { eid: app.eid, access: 'public' })
let send = async (path: string, init: RequestInit = {}) => {
  let r = await ask(path, init, KERNEL)
  return { status: r.status, body: r.status == 204 ? null : await r.json() }
}
let post = (path: string, body: unknown) =>
  send(path, { method: 'POST', body: JSON.stringify(body) })
let titles = (rows: { doc?: { title: string } }[]) =>
  rows.map((r) => r.doc?.title).sort()

let kept = crypto.randomUUID(), born = crypto.randomUUID()
await post('/apply', [{ entity: { eid: kept }, doc: { title: 'live' } }])
let ctx = p.states.get(name)!
let required = () => requirements(driver(ctx.storage))
let before = required()
let listed = await send('/branches')
let made = await post('/branches', {})
let id = made.body.branch.id
let wrote = await post(`/branches/${id}/apply`, {
  bundles: [
    { entity: { eid: kept }, doc: { title: 'drafted' } },
    { entity: { eid: born }, doc: { title: 'new' } },
  ],
})
await post('/apply', [{ entity: { eid: kept }, doc: { title: 'live again' } }])
let onIt = await post(`/branches/${id}/query`, { query: '.doc' })
let main = await send('/query?q=.doc')
let changes = await send(`/branches/${id}/changes`)

// A new incarnation over the same object, as a deploy or an eviction makes.
let again = new Store(ctx, p.env)
let reread = await again.fetch(
  new Request(`https://store/branches/${id}/query`, {
    method: 'POST',
    headers: { ...KERNEL, 'x-store': name },
    body: JSON.stringify({ query: '.doc' }),
  }),
)
let rereadRows = await reread.json()
let dropped = await send(`/branches/${id}`, { method: 'DELETE' })
let after = await send('/branches')
let trash = await send('/branches?trash=true')
let restored = await post(`/branches/${id}/restore`, {})
let recovered = await post(`/branches/${id}/query`, { query: '.doc' })
await send(`/branches/${id}`, { method: 'DELETE' })

test('a store keeps no versions until its first branch, and then requires the journal', () => {
  equal(before.includes('@yaks/journal'), false)
  equal(listed.body, { branches: [] })
  equal(made.status, 201)
  ok(required().includes('@yaks/journal'))
})

test('a branch reads main as of its fork under its own writes, and main never sees it', () => {
  equal(wrote.status, 200, JSON.stringify(wrote.body))
  equal(titles(onIt.body.rows), ['drafted', 'new'])
  equal(titles(main.body), ['live again'])
})

test('a branch’s changes are each component it wrote', () =>
  equal(
    changes.body.changes.map((c: { eid: string }) => c.eid).sort(),
    [kept, born].sort(),
  ))

test('a later incarnation composes the versions its data requires', () => {
  equal(reread.status, 200, JSON.stringify(rereadRows))
  equal(titles(rereadRows.rows), ['drafted', 'new'])
})

test('a trashed branch is hidden and returns with its writes on restore', () => {
  equal(dropped.status, 204)
  equal(after.body, { branches: [] })
  equal(trash.body.branches.map((b: { id: number }) => b.id), [id])
  ok(trash.body.branches[0].trashed)
  equal(restored.status, 200)
  equal(restored.body.branch.id, id)
  equal(titles(recovered.body.rows), ['drafted', 'new'])
})

test('a store with more live rows than one pass takes still makes its first branch in one call', async () => {
  let big = await ownedBy(dir, 'branch-owner', 'branching-big')
  await dir.apply({
    entities: [{
      entity: { eid: '$app' },
      app: {
        slug: 'big',
        version: 1,
        space: big.eid,
        store: 'branching-big/big.123456',
        access: 'public',
      },
      doc: { title: 'Big' },
    }],
  })
  let bigApp = (await dir.app(big, 'big'))!
  await declared(p.env, big, bigApp)
  let at = storeOf(p.env.STORE, storeName(big, bigApp), {
    eid: bigApp.eid,
    access: 'public',
  })
  // More than one pass takes: SEEDS pages of 512 (graph.ts `#seeding`).
  let rows = Array.from({ length: 4_200 }, (_, n) => ({
    entity: { eid: crypto.randomUUID() },
    doc: { title: `row ${n}` },
  }))
  let wrote = await at('/apply', {
    method: 'POST',
    body: JSON.stringify(rows),
  }, KERNEL)
  equal(wrote.status, 200, await wrote.text())
  let made = await at('/branches', { method: 'POST', body: '{}' }, KERNEL)
  equal(made.status, 201, await made.text())
})

test('a branch door is the kernel’s alone', async () => {
  let r = await ask('/branches', {}, {})
  ok(r.status >= 400, String(r.status))
  await r.body?.cancel()
})
