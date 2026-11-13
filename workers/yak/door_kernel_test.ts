// App and connector reads decode the Store response before answering.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { connector, kernel, seed } from './probe.ts'

test('kernel reads app and connector data through the Store door', async () => {
  let k = await kernel()
  let { cookie } = await seed(k, [{ slug: 'doorbodyprobe', apps: ['recipes'] }])
  let query = await k.at(
    'doorbodyprobe.yaks.app',
    '/recipes/api/query?q=.doc',
  )
  assertEquals(query.status, 200)
  assertEquals(Array.isArray(await query.json()), true)

  // The page's grammar reads the same as the query string or escaped as `q=`,
  // which is how a worker reads through `env.STORE` and `env.APP`.
  let eid = crypto.randomUUID()
  let wrote = await k.at('doorbodyprobe.yaks.app', '/recipes/api/apply', {
    method: 'POST',
    headers: { cookie },
    body: JSON.stringify([{ entity: { eid }, doc: { title: 'Cake' } }]),
  })
  assertEquals(wrote.status, 200, await wrote.text())
  for (
    let path of [
      `?id=${eid}&?doc`,
      `?q=${encodeURIComponent(`id=${eid}&?doc`)}`,
    ]
  ) {
    let read = await k.at('doorbodyprobe.yaks.app', `/recipes/api/query${path}`)
    assertEquals(read.status, 200, path)
    assertEquals((await read.json())[0]?.doc?.title, 'Cake', path)
  }

  let vocab = await k.at(
    'doorbodyprobe.yaks.app',
    '/recipes/api/vocab.json',
  )
  assertEquals(vocab.status, 200)
  assertEquals(Array.isArray(await vocab.json()), true)

  let answer = await connector(k, cookie).answer('graph_query', {
    app: 'recipes',
    space: 'doorbodyprobe',
    q: '.doc',
  })
  assertEquals(Array.isArray(JSON.parse(answer.text)), true)
})
