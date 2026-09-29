// A hosted Store in workerd accepts one stable build per query binding. The
// old-index migration is exercised through the Store's persisted DO adapter.

import { assertEquals } from '@std/assert'
import { identityEid } from '@yaks/graph'
import { connector, seed, workerd } from './probe.ts'

Deno.test('a hosted builder keeps independent builds for 50 bindings', async () => {
  let k = workerd()
  let space = `buildidx${crypto.randomUUID().slice(0, 6)}`
  let { cookie } = await seed(k, [{ slug: space, apps: ['index'] }])
  let agent = connector(k, cookie)
  let builder = crypto.randomUUID()
  let apply = (entities: unknown[]) =>
    agent.tool('graph_apply', { space, app: 'index', entities })
  await apply([{ entity: { eid: builder }, builder: {} }])
  await apply(Array.from({ length: 50 }, (_, i) => ({
    entity: {
      eid: identityEid('build', [builder, `["${i}"]`, 'main']),
    },
    build: { builder, match: `["${i}"]`, variant: 'main' },
  })))
  let rows = JSON.parse(
    await agent.tool('graph_query', {
      space,
      app: 'index',
      filter: `.build.builder=${builder}&*`,
    }),
  ) as unknown[]
  assertEquals(rows.length, 50)
})
