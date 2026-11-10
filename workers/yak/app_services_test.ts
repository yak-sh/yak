import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseTools } from '@yaks/tools/declared'
import { keepDeclaration } from './declaration.ts'
import { releaseOf } from './directory.ts'
import { serviceOffer } from './app-services.ts'
import { platform, seeded } from './serving-probe.ts'

test('app service catalog follows the declaration without copying a command schema', async () => {
  await using p = platform()
  let { dir, space, app } = await seeded(p.env, 'private')
  let words = {
    $defs: {
      quote: {
        tool: true,
        description: 'Quote the exact book',
        revision: 'v2',
        floor: 'person',
        input: { quantity: { type: 'integer' } },
        required: ['quantity'],
        worker: '/quote',
        service: { pricing: 'Printing plus shipping, confirmed at checkout' },
      },
      internal: {
        tool: true,
        description: 'Private work',
        worker: '/internal',
      },
    },
  }
  await keepDeclaration(p.env, space, app, releaseOf(app), {
    vocab: {},
    tools: parseTools(words, []),
  })
  let offer = { name: 'books', hosts: [], service: { app: app.eid } }
  let found = await serviceOffer(p.env, dir, offer)
  assertEquals(found?.commands.map((c) => c.name), ['quote'])
  assertEquals(found?.commands[0].input.required, ['quantity'])
  assertEquals(found?.commands[0].floor, 'person')
  assertEquals(found?.commands[0].revision, 'v2')
  assertEquals(found?.commands[0].pricing, words.$defs.quote.service.pricing)
})
