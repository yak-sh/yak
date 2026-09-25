import { pkt } from '@yaks/git'
import type { Bundle } from '@yaks/graph'
import { assert, assertEquals } from '@std/assert'
import {
  client,
  connector,
  kernel,
  meta,
  num,
  seed,
  vocabFile,
} from './probe.ts'

Deno.test(
  'hosted app archetypes classify and query writes through the deployed Worker',
  async () => {
    let k = await kernel()
    try {
      let { cookie } = await seed(k, [{ slug: 'jeff1', apps: ['recipes'] }])
      // The directory shares classification but retains its own vocabulary.
      const directoryRows = await meta(k).query(
        '.archetype&.limit=2',
      )
      assert(directoryRows.length > 0)
      assert(
        directoryRows.every((b) =>
          typeof (b as unknown as Bundle).entity.archetype == 'string'
        ),
      )
      let app = client(k, 'jeff1.yaks.app', 'recipes', cookie)
      let planted = await app.put(
        '/vocab.json',
        vocabFile({ recipe: { serves: num }, specialty: {} }),
      )
      await app.put('/index.html', '<!doctype html><h1>Recipes</h1>')
      await connector(k, cookie).tool('app_deploy', {
        space: 'jeff1',
        app: 'recipes',
      })
      let wrote = await app.post([{
        entity: { eid: 'cake' },
        doc: { title: 'Cake' },
        recipe: { serves: 4 },
      }])
      assertEquals(wrote.status, 200)
      assertEquals(planted.status, 200)
      let rows = await app.get('.recipe') as Bundle[]
      assertEquals(rows.length, 1)
      assert(typeof rows[0].entity.archetype == 'string')
      let prior = rows[0].entity.archetype
      await app.post([{ entity: { eid: 'cake' }, specialty: {} }])
      rows = await app.get('.recipe&.specialty') as Bundle[]
      assertEquals(rows.length, 1)
      assert(rows[0].entity.archetype != prior)
      await app.post([{ entity: { eid: 'cake' }, specialty: null }])
      assertEquals((await app.get('.recipe&.specialty')).length, 0)
      // A deploy also writes the separate Git object store; cloning traverses it.
      const refs = await k.at(
        'jeff1.yaks.app',
        '/recipes.git/info/refs?service=git-upload-pack',
        {
          headers: { cookie, 'git-protocol': 'version=2' },
        },
      )
      assertEquals(refs.status, 200, await refs.clone().text())
      assert((await refs.text()).includes('version 2'))
      const utf8 = new TextDecoder()
      const advertised = await k.at(
        'jeff1.yaks.app',
        '/recipes.git/git-upload-pack',
        {
          method: 'POST',
          headers: {
            cookie,
            'git-protocol': 'version=2',
            'content-type': 'application/x-git-upload-pack-request',
          },
          body: utf8.decode(pkt('command=ls-refs\n')) + '0001' +
            utf8.decode(pkt('peel\n')) + '0000',
        },
      )
      assertEquals(advertised.status, 200)
      const branches = await advertised.text()
      const oid = /([0-9a-f]{40}) refs\/heads\/main/.exec(branches)?.[1]
      assert(oid, branches)
      const packed = await k.at(
        'jeff1.yaks.app',
        '/recipes.git/git-upload-pack',
        {
          method: 'POST',
          headers: {
            cookie,
            'git-protocol': 'version=2',
            'content-type': 'application/x-git-upload-pack-request',
          },
          body: utf8.decode(pkt('command=fetch\n')) + '0001' +
            utf8.decode(pkt('want ' + oid + '\n')) +
            utf8.decode(pkt('done\n')) + '0000',
        },
      )
      assertEquals(packed.status, 200)
      assert((await packed.text()).includes('PACK'))

      let definitions = await app.get('.archetype')
      assert(definitions.length > 0)
      assert(definitions.some((b) => b.entity.eid == prior))
    } finally {
      await k.stop()
    }
  },
)
