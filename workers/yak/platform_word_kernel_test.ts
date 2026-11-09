// A platform word belongs to no app, and a write that names an app stays in
// its space. Two spaces: one app held its own `event` before @yaks/events
// made the word the platform's (vocab.ts `beneath`), the other speaks the
// platform's. A write naming the second went to the first, whose store
// refused the platform's properties (T-151875).
import { cleanup, equal, test } from '@yaks/testing'
import { connector, fresh, seed } from './probe.ts'
import { appStore } from './directory.ts'
import { declared } from './directory-fixture.ts'
import { ACCEPTED } from './door.ts'
import type { Env } from './env.ts'
import { KERNEL } from './meta.ts'

let env!: Env
let k = await fresh({}, (value) => env = value)
cleanup(() => k.stop())
let them = await seed(k, [
  { slug: 'township', apps: ['hall'] },
  { slug: 'grove', apps: ['church'] },
])
let agent = connector(k, them.cookie)

// The township's own `event`, as a release admitted before the platform's.
let held = {
  $defs: {
    event: {
      component: true,
      properties: {
        starts: { type: 'string', format: 'date-time' },
        place: { type: 'string' },
      },
    },
  },
}
await agent.tool('app_files', {
  space: 'township',
  app: 'hall',
  op: 'write',
  path: 'vocab.json',
  content: '{}',
})
await agent.tool('app_deploy', { space: 'township', app: 'hall' })
let township = (await k.dir.space('township'))!
let hall = (await k.dir.app(township, 'hall'))!
let planted = await appStore(env.STORE, township, hall, env)('/vocab', {
  method: 'POST',
  body: JSON.stringify(held),
}, { ...KERNEL, [ACCEPTED]: JSON.stringify(['event']) })
if (!planted.ok) throw new Error(await planted.text())
await planted.body?.cancel()
await declared(env, township, hall, { vocab: held, tools: {} })

let event = {
  starts: '2024-10-13T09:15:00',
  ends: '2024-10-13T10:15:00',
  repeats: 'FREQ=WEEKLY;BYDAY=SU',
  zone: 'America/Detroit',
  place: 'Locust Grove',
}
let sunday = crypto.randomUUID(), bible = crypto.randomUUID()
await agent.tool('graph_apply', {
  space: 'grove',
  app: 'church',
  entities: [{
    entity: { eid: sunday },
    doc: { title: 'Sunday school' },
    event,
  }],
})
await agent.tool('graph_apply', {
  entities: [{
    entity: { eid: bible },
    doc: { title: 'Bible study' },
    event,
    $app: 'grove/church',
  }],
})

let eids = async (args: Record<string, unknown>) =>
  (await agent.answer('graph_query', { query: '.event', ...args })).rows
    .map((b) => b.entity.eid).sort()

test('a platform word goes to the app the write names, in its space', async () => {
  equal(await eids({ space: 'grove', app: 'church' }), [sunday, bible].sort())
  equal(await eids({ space: 'township', app: 'hall' }), [])
})

test('a read naming no app asks every store for a platform word', async () => {
  equal(await eids({}), [sunday, bible].sort())
})
