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
