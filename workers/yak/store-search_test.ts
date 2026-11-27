// A draft can be the first writer of a component in a newly provisioned store.
import { equal, test } from '@yaks/testing'
import { driver } from '@yaks/durable-object'
import { due } from '@yaks/embedding'
import { statements } from '@yaks/sqlite'
import { val } from '@yaks/sql'
import { durable } from '../../packages/durable-object/testing.ts'
import { Store } from './graph.ts'

let ONE = '10000000-0000-4000-8000-000000000001'
let TWO = '20000000-0000-4000-8000-000000000002'
let fixture = () => {
  let storage = durable()
  let store: Store
  let wake = (id = 'version') => {
    store = new Store(
      { storage, getWebSockets: () => [], acceptWebSocket: () => {} },
      { CF_VERSION_METADATA: { id } },
      [],
    )
  }
  wake()
  let send = async (path: string, body?: unknown) => {
    let response = await store.fetch(
      new Request(`https://store${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'x-store': 'search/drafts', 'x-yak-kernel': '1' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    )
    let answer = await response.json()
    equal(response.status < 400, true, JSON.stringify(answer))
    return answer
  }
  let found = async () =>
    (await send('/query?q=curry%20.limit=1'))
      .map((row: { entity: { eid: string } }) => row.entity.eid)
  return { storage, wake, send, found }
}

test('a component first written on a draft keeps main searchable after eviction', async () => {
  let { send, wake, found } = fixture()
  let { branch } = await send('/branches', {})
  await send(`/branches/${branch.id}/apply`, {
    bundles: [{ entity: { eid: ONE }, doc: { title: 'draft curry' } }],
  })
  wake()
  await send('/apply', [{ entity: { eid: TWO }, doc: { title: 'curry' } }])
  equal(await found(), [TWO])
})

test('a new runtime restores missing search objects and indexes the rows already held', async () => {
  let { storage, send, wake, found } = fixture()
  await send('/apply', [{ entity: { eid: ONE }, doc: { title: 'curry' } }])
  let db = driver(storage), sql = statements(db)
  let doc = db.stored?.v?.stored('doc') ?? 'doc'
  db.query({ t: 'drop', kind: 'table', name: `${doc}_fts` })
  for (let event of ['insert', 'update', 'delete']) {
    db.query({
      t: 'drop',
      kind: 'trigger',
      name: `embedding_owed_doc_${event}`,
    })
  }
  db.query({ t: 'delete', from: 'embedding_owed' })
  wake('next version')
  equal(await found(), [ONE])
  equal(due(sql, 20).length, 1)
  db.query({ t: 'delete', from: 'embedding_owed' })
  db.query({ t: 'update', table: 'doc', set: { title: val('curry again') } })
  equal(due(sql, 20).length, 1)
  wake('next version')
  equal(await found(), [ONE])
})
