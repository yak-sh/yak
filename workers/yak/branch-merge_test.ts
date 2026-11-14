// A branch of an app store merged into its live rows (graph.ts `#merging`):
// what only the branch wrote goes in, what the live app wrote meanwhile
// stays, and a property both changed waits for a pick made seeing the live
// value as it stands.
import { equal, test } from '@yaks/testing'
import { ownedBy } from './directory-fixture.ts'
import { directory, fetch as directoryFetch, storeName } from './directory.ts'
import { storeOf } from './door.ts'
import { KERNEL } from './meta.ts'
import { declared, platform } from './testing.ts'

let p = platform('branch merge')
let dir = directory({ fetch: (r) => directoryFetch(r, p.env) })
let space = await ownedBy(dir, 'merge-owner', 'merging')
await dir.apply({
  entities: [{
    entity: { eid: '$app' },
    app: {
      slug: 'notes',
      version: 1,
      space: space.eid,
      store: 'merging/notes.123456',
      access: 'public',
    },
    doc: { title: 'Notes' },
  }],
})
let app = (await dir.app(space, 'notes'))!
await declared(p.env, space, app)
let ask = storeOf(p.env.STORE, storeName(space, app), {
  eid: app.eid,
  access: 'public',
})
let releaser = { ...KERNEL, 'x-yak-person': crypto.randomUUID() }
let send = async (path: string, init: RequestInit = {}) => {
  let r = await ask(path, init, releaser)
  return { status: r.status, body: r.status == 204 ? null : await r.json() }
}
let post = (path: string, body: unknown) =>
  send(path, { method: 'POST', body: JSON.stringify(body) })
let titles = async () =>
  Object.fromEntries(
    (await send('/query?q=.doc')).body.map((
      r: { entity: { eid: string }; doc: { title: string } },
    ) => [r.entity.eid, r.doc.title]),
  )

let both = crypto.randomUUID(), theirs = crypto.randomUUID()
let born = crypto.randomUUID()
await post('/apply', [
  { entity: { eid: both }, doc: { title: 'live' } },
  { entity: { eid: theirs }, doc: { title: 'live' } },
])
let id = (await post('/branches', {})).body.branch.id
await post(`/branches/${id}/apply`, {
  bundles: [
    { entity: { eid: both }, doc: { title: 'drafted' } },
    { entity: { eid: born }, doc: { title: 'new' } },
  ],
})
// The person goes on writing the live app while the draft is open.
await post('/apply', [
  { entity: { eid: both }, doc: { title: 'live again' } },
  { entity: { eid: theirs }, doc: { title: 'the person’s' } },
])
let merge = (picks?: unknown[]) => post(`/branches/${id}/merge`, { picks })
let pick = (take: string, main: string) => ({
  eid: both,
  comp: 'doc',
  prop: 'title',
  take,
  main,
})

let unpicked = await merge()
let waiting = await titles()
let stale = await merge([pick('branch', 'live')])
let picked = await merge([pick('main', 'live again')])
let merged = await titles()
let left = await send('/branches')
let [row] = (await send(`/query?q=.entity.eid=${born} ?created`)).body

test('a property both changed is a conflict, side by side, and nothing is written', () => {
  equal(unpicked.body, {
    conflicts: [{
      eid: both,
      comp: 'doc',
      prop: 'title',
      fork: 'live',
      branch: 'drafted',
      main: 'live again',
    }],
    merged: 0,
  })
  equal(waiting[born], undefined)
})

test('a pick made seeing a live value since changed settles nothing', () =>
  equal(stale.body.conflicts.length, 1))

test('once picked, what the branch wrote goes in and the live app’s writes stay', () => {
  equal(picked.body, { conflicts: [], merged: 1 })
  equal(merged, {
    [both]: 'live again',
    [theirs]: 'the person’s',
    [born]: 'new',
  })
})

test('a merged branch is dropped', () => equal(left.body, { branches: [] }))

test('the merge is written as the releasing caller', () =>
  equal(row.created.by, releaser['x-yak-person']))
