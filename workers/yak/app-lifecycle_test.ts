import { equal, test } from '@yaks/testing'
import { lifecycleStores } from './app-lifecycle-probe.ts'
import { platform } from './directory-rows-probe.ts'
import { ADA, SECRET } from './serving-data-probe.ts'

test('candidate declarations and seed trials leave the serving graph alone until selected', async () => {
  let { env } = platform(SECRET)
  lifecycleStores(env)
  let app = crypto.randomUUID()
  let store = env.STORE.get(env.STORE.idFromName('candidate'))
  let request = (
    path: string,
    release: string,
    body?: unknown,
    base?: string,
  ) =>
    store.fetch(
      new Request('https://store' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'x-yak-app': app,
          'x-yak-access': 'private',
          'x-yak-person': ADA,
          'x-yak-role': 'owner',
          'x-yak-release': release,
          ...(base === undefined ? {} : { 'x-yak-base-release': base }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    )
  let words = { $defs: { note: { properties: { text: { type: 'string' } } } } }
  equal(await (await request('/vocab', '0')).json(), {})
  equal((await request('/vocab', '1', words, '0')).status, 200)
  equal(
    (await request('/seed', '1', [{
      entity: { eid: '$note' },
      note: { text: 'accepted' },
    }], '0')).status,
    200,
  )
  equal(await (await request('/vocab', '0')).json(), {})
  equal(await (await request('/query?q=.doc', '0')).json(), [])
  let rows = await (await request('/query?q=.note', '1')).json()
  equal(rows.map((row: { note: { text: string } }) => row.note.text), [
    'accepted',
  ])
  let serving = await (await request('/vocab', '1')).json()
  let next = {
    $defs: {
      ...words.$defs,
      other: { properties: { title: { type: 'string' } } },
    },
  }
  equal((await request('/vocab', '2', next, '1')).status, 200)
  equal(
    (await request('/seed', '2', [{
      entity: { eid: '$bad' },
      note: { text: 'refused' },
      created: { at: '2000-01-01T00:00:00Z' },
    }], '1')).ok,
    false,
  )
  equal(await (await request('/vocab', '1')).json(), serving)
  rows = await (await request('/query?q=.note', '1')).json()
  equal(rows.map((row: { note: { text: string } }) => row.note.text), [
    'accepted',
  ])

  let deleted = rows[0].entity.eid
  equal(
    (await request('/apply', '1', [{
      entity: { eid: deleted },
      $delete: true,
    }])).status,
    200,
  )
  equal((await request('/vocab', '3', next, '1')).status, 200)
  equal(
    (await request(`/seed?from=${crypto.randomUUID()}`, '3', [{
      entity: { eid: deleted },
      note: { text: 'must stay deleted' },
    }], '1')).status,
    200,
  )
  equal(await (await request('/query?q=.note', '3')).json(), [])
})
