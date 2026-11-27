import { archetypeDoc, archetypes } from '@yaks/archetype'
import { type Bundle, graph, mint } from '@yaks/graph'
import { line } from '@yaks/query'
import { storage } from '@yaks/sqlite'
import { seed, stepping } from '@yaks/sqlite/testing'
import { equal, ok, test } from '@yaks/testing'
import { loadVocab, pick } from '@yaks/vocab'
import { directoryIndex } from './directory-index.ts'
import { directoryHoldsMove } from './directory-index-move.ts'
import { directoryDoc, referralDoc } from './directory-vocab.ts'
import { platformDoc } from './vocab.ts'
import { ADMIN, DEMO, NUMBERS } from './bots.ts'

let words = loadVocab([
  archetypeDoc,
  {
    $defs: {
      person: { component: true, type: 'object' },
      entity: { component: true, properties: { num: { type: 'number' } } },
      email: { component: true, properties: { address: { type: 'string' } } },
      phone: { component: true, properties: { number: { type: 'string' } } },
    },
  },
  pick(platformDoc, ['app', 'space']),
  pick(referralDoc, ['referral']),
  pick(directoryDoc, [
    'directory_order',
    'holds',
    'member',
    'newcomer',
    'test',
  ]),
  {
    $defs: {
      used: { component: true, properties: { at: { type: 'string' } } },
      trashed: { component: true, type: 'object' },
      signed_in: { component: true, properties: { at: { type: 'string' } } },
    },
  },
])

let fixture = () => {
  let { driver, steps } = stepping()
  let store = storage(driver, words, { number: true, counts: 'eager' })
  store.install()
  let g = graph({
    vocab: words,
    storage: store,
    plugins: [archetypes(), directoryIndex()],
  })
  return { g, store, steps }
}
let { g } = fixture()
let [space, app, seat, guest, owner, otherSeat] = Array.from(
  { length: 6 },
  mint,
)
let at = '2026-11-27T00:00:00Z'
await g.apply([
  { entity: { eid: space }, space: { slug: 'lab' } },
  { entity: { eid: guest }, person: {}, newcomer: { client: 'agent' } },
  { entity: { eid: owner }, person: {}, email: { address: ADMIN } },
  { entity: { eid: app }, app: { space, slug: 'notes' }, used: { at } },
  { entity: { eid: seat }, member: { space, person: guest, role: 'owner' } },
  {
    entity: { eid: otherSeat },
    member: { space, person: owner, role: 'viewer' },
  },
], { trusted: true })

test('a space and app follow its seats; a browser sign-in clears an inferred test mark', async () => {
  let marked = async () =>
    new Set(
      (await g.read(line`.entity.eid=${[space, app, guest, owner]}&.test`)).map(
        (r) => r.entity.eid,
      ),
    )
  equal(await marked(), new Set([guest]))
  await g.apply([{ entity: { eid: otherSeat }, $delete: true }], {
    trusted: true,
  })
  equal(await marked(), new Set([guest, space, app]))
  await g.apply([{
    entity: { eid: guest },
    newcomer: null,
    email: { address: 'guest@example.com' },
  }], { trusted: true })
  equal(await marked(), new Set())
  await g.apply([{ entity: { eid: seat }, $delete: true }], { trusted: true })
  equal(await marked(), new Set())
  let [row] = await g.get([guest], ['directory_order'])
  equal(row.directory_order, { kind: 'person', visible_kind: 'person' })
})

test('a space keeps how many apps it has outside the trash', async () => {
  let other = mint(), more = mint()
  let apps = async () =>
    (await g.get([space, other], ['holds'])).map((r) => r.holds)
  let write = (...rows: Bundle[]) => g.apply(rows, { trusted: true })
  await write({ entity: { eid: other }, space: { slug: 'shop' } })
  equal(await apps(), [{ apps: 1 }, { apps: 0 }])
  await write({ entity: { eid: more }, app: { space, slug: 'cart' } })
  equal(await apps(), [{ apps: 2 }, { apps: 0 }])
  await write({ entity: { eid: more }, trashed: {} })
  equal(await apps(), [{ apps: 1 }, { apps: 0 }])
  await write({ entity: { eid: more }, trashed: null })
  equal(await apps(), [{ apps: 2 }, { apps: 0 }])
  await write({ entity: { eid: more }, app: { space: other } })
  equal(await apps(), [{ apps: 1 }, { apps: 1 }])
  await write({ entity: { eid: more }, $delete: true })
  equal(await apps(), [{ apps: 1 }, { apps: 0 }])
})

test('the mover counts a space the index kept before it kept holds', async () => {
  let old = fixture()
  let [lab, notes, cart] = Array.from({ length: 3 }, mint)
  seed(old.store, [
    { entity: { eid: lab }, space: { slug: 'lab' } },
    { entity: { eid: notes }, app: { space: lab, slug: 'notes' } },
    { entity: { eid: cart }, app: { space: lab, slug: 'cart' }, trashed: {} },
  ])
  let found = await old.g.read(directoryHoldsMove.find)
  equal(found.map((r) => r.entity.eid), [lab])
  await old.g.apply(found.flatMap(directoryHoldsMove.move), { trusted: true })
  equal((await old.g.get([lab], ['holds']))[0].holds, { apps: 1 })
  equal(await old.g.read(directoryHoldsMove.find), [])
})

let users: Bundle[] = [
  ADMIN,
  DEMO,
  'test@bot.yak.sh',
  'fixture@nowhere.invalid',
]
  .map((address) => ({
    entity: { eid: mint() },
    person: {},
    email: { address },
  }))
let phone = {
  entity: { eid: mint() },
  person: {},
  phone: { number: [...NUMBERS][0] },
}
let explicit = { entity: { eid: mint() }, person: {}, test: {} }
let browser = {
  entity: { eid: mint() },
  person: {},
  newcomer: { client: 'browser' },
}
let old = { entity: { eid: mint() }, person: {}, newcomer: {} }
let accounts = [...users, phone, explicit, browser, old]
await g.apply(accounts, { trusted: true })

test('fleet addresses and numbers get the mark, with admin, demo and browsers excluded', async () => {
  let found = await g.read(
    line`.entity.eid=${accounts.map((b) => b.entity.eid)}&.test`,
  )
  equal(
    new Set(found.map((r) => r.entity.eid)),
    new Set(
      [...users.slice(2), phone, explicit].map((r) => r.entity.eid),
    ),
  )
})

let sparse = fixture()
let rows: Bundle[] = Array.from({ length: 2400 }, (_, i) => {
  let visible = i < 70
  return {
    entity: { eid: mint(), num: i + 1 },
    app: { slug: `app-${i}` },
    directory_order: {
      kind: 'app',
      visible_kind: visible ? 'app' : null,
      at: visible && i < 10 ? null : new Date(100000 * i).toISOString(),
    },
    ...visible ? {} : { test: {} },
  }
})
seed(sparse.store, rows)
let newest = rows.slice(0, 70).toReversed()

test('unfiltered counts and sparse listings read their buckets and indexed pages', () => {
  let start = sparse.steps()
  let count = sparse.store.rows('.app&!test&.count')
  equal(count, [{ value: '', n: 70 }])
  ok(sparse.steps() - start < 250)
  let listing = (after?: string) =>
    sparse.store.rows(
      after
        ? line`.directory_order.visible_kind=app&.order=-directory_order.at&.limit=51&.after=${after}`
        : line`.directory_order.visible_kind=app&.order=-directory_order.at&.limit=51`,
    )
  start = sparse.steps()
  let first = listing()
  equal(first.map((r) => r.eid), newest.slice(0, 51).map((r) => r.entity.eid))
  let next = listing(String(first[49].eid))
  equal(next.map((r) => r.eid), newest.slice(50).map((r) => r.entity.eid))
  ok(sparse.steps() - start < 5000, `${sparse.steps() - start} VM steps`)
})
