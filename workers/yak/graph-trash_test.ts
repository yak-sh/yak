import { graph, mint } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal, test } from '@yaks/testing'
import { trashDoor } from './graph-trash.ts'
import { directory, over } from './directory.ts'
import { metaOf } from './meta.ts'
import { doorOf } from '@yaks/durable-object/door'
import { type Reach, trashed } from './reach.ts'
import type { Env } from './env.ts'

let vocab = loadVocab([{
  $defs: {
    note: { component: true, properties: { body: { type: 'string' } } },
  },
}])
let fixture = async () => {
  let g = graph({ vocab, storage: ram(vocab) })
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
