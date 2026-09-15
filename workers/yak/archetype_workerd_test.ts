import type { Bundle } from '@yaks/graph'
import { assert, assertEquals } from '@std/assert'
import { slow } from '../../src/testing.ts'
import { client, connector, kernel, seed } from './probe.ts'

slow(
  'hosted app archetypes classify and query writes through the deployed Worker',
  async () => {
    let k = await kernel()
    try {
      let { cookie } = await seed(k, [{ slug: 'jeff', apps: ['recipes'] }])
      let app = client(k, 'jeff.yaks.app', 'recipes', cookie)
      let planted = await app.put(
        '/vocab.json',
        '{"recipe":{"serves":"number"},"specialty":{}}',
      )
      await app.put('/index.html', '<!doctype html><h1>Recipes</h1>')
      await connector(k, cookie).tool('app_deploy', {
        space: 'jeff',
        app: 'recipes',
      })
      let wrote = await app.post([{
        entity: { eid: 'cake' },
        doc: { title: 'Cake' },
        recipe: { serves: 4 },
      }])
      assertEquals(wrote.status, 200)
      assertEquals(planted.status, 200)
      let rows = await app.get('.recipe!') as Bundle[]
      assertEquals(rows.length, 1)
      assert(typeof rows[0].entity.archetype == 'string')
      let prior = rows[0].entity.archetype
      await app.post([{ entity: { eid: 'cake' }, specialty: {} }])
      rows = await app.get('.recipe!&.specialty!') as Bundle[]
      assertEquals(rows.length, 1)
      assert(rows[0].entity.archetype != prior)
      await app.post([{ entity: { eid: 'cake' }, specialty: null }])
      assertEquals((await app.get('.recipe!&.specialty!')).length, 0)
      let definitions = await app.get('.archetype!')
      assert(definitions.length > 0)
      assert(definitions.some((b) => b.entity.eid == prior))
    } finally {
      await k.stop()
    }
  },
)
