import { graph, mint } from '@yaks/graph'
import { trashOrder } from '@yaks/graph/trash'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal, test } from '@yaks/testing'
import { trashDoor } from './graph-trash.ts'
import { directory, over } from './directory.ts'
import { metaOf } from './meta.ts'
import { doorOf } from '@yaks/durable-object/door'
import { type Reach, trashed } from './reach.ts'
import type { Env } from './env.ts'
import { appGuard } from '@yaks/platform/app-authority'
import { Denied, memberDoc, memberKeywords } from '@yaks/member'
import { assertRejects } from '@std/assert'

let vocab = loadVocab([{
  $defs: {
    note: { component: true, properties: { body: { type: 'string' } } },
  },
}])
let fixture = async (words = vocab) => {
  let g = graph({ vocab: words, storage: ram(words) })
  let eid = mint()
  await g.apply([{ entity: { eid }, note: { body: 'kept' } }])
  await g.apply([{ entity: { eid }, $delete: true }])
  let [entry] = await g.storage.trash!([eid])
  return { g, eid, entry }
}
let read = (eid: string, headers = {}) =>
  new Request(
    `http://store/trash?eid=${eid}`,
    { headers },
  )
let post = (path: string, id: string, eid: string, headers = {}) =>
  new Request(
    `http://store/trash/${path}`,
    { method: 'POST', headers, body: JSON.stringify({ id, eids: [eid] }) },
  )
let owner = { 'x-yak-person': mint(), 'x-yak-role': 'owner' }
let kernel = { 'x-yak-kernel': '1' }
let access = await fixture()
let restored = await fixture()
let purged = await fixture()
let transported = await fixture()
let binding = {
  fetch: (req: Request) =>
    over(metaOf(doorOf(
      (req) => trashDoor(req, transported.g, true),
    )))(req),
}
let dir = directory(binding)

test('app trash excludes visitors, viewers and directory clients', async () => {
  for (let headers of [{}, { ...owner, 'x-yak-role': 'viewer' }]) {
    equal(
      (await trashDoor(read(access.eid, headers), access.g, false)).status,
      404,
    )
  }
  equal((await trashDoor(read(access.eid, owner), access.g, true)).status, 404)
  equal((await trashDoor(read(access.eid, owner), access.g, false)).status, 200)
})

test('a named editor restores retained data without purging its archive', async () => {
  let r = await trashDoor(
    post('restore', restored.entry.id, restored.eid, {
      ...owner,
      'x-yak-role': 'editor',
    }),
    restored.g,
    false,
  )
  equal(r.status, 200)
  equal((await restored.g.get([restored.eid]))[0].note, { body: 'kept' })
  equal((await restored.g.storage.trash!([restored.eid])).length, 1)
})

test('an app client cannot purge but the internal confirmation path can', async () => {
  let ask = (headers: Record<string, string>) =>
    trashDoor(
      post('purge', purged.entry.id, purged.eid, headers),
      purged.g,
      false,
    )
  equal((await ask(owner)).status, 404)
  equal((await purged.g.storage.trash!([purged.eid])).length, 1)
  equal((await ask(kernel)).status, 200)
  equal(await purged.g.storage.trash!([purged.eid]), [])
})

test('Directory reads, restores and purges through its Meta transport', async () => {
  let [entry] = await dir.trash([transported.eid])
  equal(entry.id, transported.entry.id)
  await dir.restoreTrash(entry.id, [transported.eid], owner)
  equal((await transported.g.get([transported.eid]))[0].note, { body: 'kept' })
  await dir.purgeTrash(entry.id, [transported.eid])
  equal(await dir.trash([transported.eid]), [])
})

let reached = await fixture()
let visits: string[] = []
let seat = (role: string | null, store = 'person/app'): Reach =>
  ({
    space: { slug: 'person' },
    app: { slug: 'app', store },
    who: { person: owner['x-yak-person'], role },
    door: doorOf((req) => {
      visits.push(store)
      return trashDoor(req, reached.g, false)
    }),
  }) as Reach

test('the hosted graph reach reads app trash only for named editors', async () => {
  let groups = await trashed({} as Env, [
    seat('viewer'),
    seat(null),
    seat('owner', 'yak/platform'),
    seat('editor'),
  ])
  equal(groups.map((group) => group.id), [reached.entry.id])
  equal(visits, ['person/app'])
})

let renamed = await fixture()
renamed.g.use({
  name: 'retained-name',
  restore: (_graph, bundles) => ({
    bundles,
    notices: ['The retained name was taken; restored as note-2.'],
  }),
})

test('HTTP restore reports names changed while restoring', async () => {
  let r = await trashDoor(
    post('restore', renamed.entry.id, renamed.eid, owner),
    renamed.g,
    false,
  )
  let result = await r.json()
  equal(result.notices, ['The retained name was taken; restored as note-2.'])
  equal(result.bundles[0].entity.eid, renamed.eid)
})

let selected = graph({ vocab, storage: ram(vocab) })
let selectedIds = [mint(), mint()]
await selected.apply(
  selectedIds.map((eid) => ({ entity: { eid }, note: { body: eid } })),
)
await selected.apply(
  selectedIds.map((eid) => ({ entity: { eid }, $delete: true })),
)
let selectedDir = directory({
  fetch: (req) =>
    over(metaOf(doorOf((req) => trashDoor(req, selected, true))))(req),
})

test('confirmed entity purges keep other rows from the same retained transaction', async () => {
  await selectedDir.purgeTrashEntities([selectedIds[0]])
  equal(await selectedDir.trash([selectedIds[0]]), [])
  let [entry] = await selectedDir.trash([selectedIds[1]])
  equal(entry.bundles.map((b) => b.entity.eid), [selectedIds[1]])
})

let protectedWords = loadVocab([memberDoc, {
  $defs: {
    note: {
      component: true,
      floor: 'owner',
      properties: { body: { type: 'string' } },
    },
  },
}], [memberKeywords])
let protectedEntry = await fixture(protectedWords)
protectedEntry.g.use(
  appGuard(mint(), protectedWords, {}, { level: () => 'editor' }),
)

test('app restore keeps component permissions after admitting the editor', async () => {
  await assertRejects(() =>
    trashDoor(
      post('restore', protectedEntry.entry.id, protectedEntry.eid, {
        ...owner,
        'x-yak-role': 'editor',
      }),
      protectedEntry.g,
      false,
    ), Denied)
})

let historical = graph({ vocab, storage: ram(vocab) })
let historicalEid = mint()
for (let n = 0; n < 25; n++) {
  await historical.apply([{
    entity: { eid: historicalEid },
    note: { body: String(n) },
  }])
  await historical.apply([{ entity: { eid: historicalEid }, note: null }])
}
let history = await historical.storage.trash!([historicalEid], { limit: 100 })
let historicalDir = directory({
  fetch: (req) =>
    over(metaOf(doorOf((req) => trashDoor(req, historical, true))))(req),
})

test('Directory pages archives and restores transactions beyond the first twenty', async () => {
  let first = await historicalDir.trash([historicalEid], { limit: 2 })
  let next = await historicalDir.trash([historicalEid], {
    after: first[1].id,
    limit: 2,
  })
  equal(
    next.map((entry) => entry.id),
    history.slice(2, 4).map((entry) => entry.id),
  )
  let oldest = history.at(-1)!
  await historicalDir.restoreTrash(oldest.id, [historicalEid], owner)
  equal((await historical.get([historicalEid]))[0].note, oldest.bundles[0].note)
})

let across = await fixture()
let acrossRows = await across.g.storage.trash!(undefined, { limit: 100 })
let combined = [...history, ...acrossRows].sort(trashOrder)
let pivot = combined.findIndex((entry, n) =>
  combined[n + 1] &&
  acrossRows.includes(entry) != acrossRows.includes(combined[n + 1])
)
let memberAt = (g: typeof historical, store: string): Reach => ({
  ...seat('owner', store),
  door: doorOf((req) => trashDoor(req, g, false)),
})

test('hosted trash pagination continues across stores that do not hold its cursor', async () => {
  let next = await trashed(
    {} as Env,
    [
      memberAt(historical, 'person/one'),
      memberAt(across.g, 'person/two'),
    ],
    undefined,
    { after: combined[pivot].id, limit: 1 },
  )
  equal(next.map((entry) => entry.id), [combined[pivot + 1].id])
})

let provenanceWords = loadVocab([{
  $defs: {
    ...vocab.docs[0].$defs,
    code: {
      component: true,
      properties: { value: { type: 'string', stamped: true } },
    },
  },
}])
let provenance = graph({
  vocab: provenanceWords,
  storage: ram(provenanceWords),
})
let provenanceEid = mint()
await provenance.apply([{
  entity: { eid: provenanceEid },
  note: { body: 'kept' },
  code: { value: 'original' },
}], { trusted: true })
await provenance.apply([{ entity: { eid: provenanceEid }, $delete: true }])
let [provenanceEntry] = await provenance.storage.trash!([provenanceEid])

test('app restore admits original server-owned values through ordinary writes', async () => {
  let r = await trashDoor(
    post('restore', provenanceEntry.id, provenanceEid, owner),
    provenance,
    false,
  )
  equal(r.status, 200)
  equal((await provenance.get([provenanceEid]))[0].code, { value: 'original' })
})
