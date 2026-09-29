// App and connector reads cross the Store response body in workerd. Their
// replies are decoded at the Store door before another layer answers them.
import { assertEquals } from '@std/assert'
import { connector, seed, workerd } from './probe.ts'

Deno.test('workerd reads app and connector data through the Store door', async () => {
  let k = workerd()
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
