/// <reference lib="deno.ns" />
// An object composed from a config: its door writes and reads its graph, a
// write that owes a run or moves a wake arms its alarm, the alarm works them,
// and a kind is planned once an isolate.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Bundle, Graph } from '@yaks/graph'
import type { Load } from '@yaks/host'
import { effectDoc } from '@yaks/effects/vocab'
import { wakeDoc } from '@yaks/wake/vocab'
import { Durable } from './object.ts'
import { composed, planned } from './compose.ts'
import { durable } from './testing.ts'

let shelf = {
  vocab: {
    docs: [effectDoc, wakeDoc, {
      $defs: {
        book: {
          component: true,
          properties: {
            title: { type: 'string' },
            shelved: { type: 'boolean' },
          },
        },
        shelve: { effect: true, created: ['book'] },
      },
    }],
  },
  effects: {
    effects: (host: { graph: Graph }) => ({
      shelve: ({ entity }: Bundle) =>
        host.graph.apply([{ entity, book: { shelved: true } }]),
    }),
  },
} as Record<string, unknown>
let config = { plugins: ['shelf'] }
let load: Load = (_plugin, name) => Promise.resolve(shelf[name] ?? null)

// A composed object over the stand-in's storage.
let object = () => {
  let storage = durable()
  let ctx = { storage, acceptWebSocket() {}, getWebSockets: () => [] }
  return { made: new Durable(ctx, composed(config, load)), storage }
}
let apply = (o: Durable, bundles: Bundle[]) =>
  o.fetch(
    new Request('https://do/apply', {
      method: 'POST',
      body: JSON.stringify(bundles),
    }),
  )
let query = async (o: Durable, q: string) =>
  await (await o.fetch(new Request(`https://do/query?q=${q}`))).json()

test('a write that owes a run arms the alarm, and the alarm runs it', async () => {
  let { made, storage } = object()
  await apply(made, [{ entity: { eid: 'b' }, book: { title: 'Dune' } }])
  assertEquals((await storage.getAlarm())! <= Date.now(), true)
  await made.alarm()
  assertEquals((await query(made, '.book'))[0].book.shelved, true)
})

test('a wake arms the alarm at its instant, and the alarm fires it', async () => {
  let { made, storage } = object()
  let at = new Date(Date.now() - 1000).toISOString()
  await apply(made, [{ entity: { eid: 'w' }, wake: { at } }])
  assertEquals(await storage.getAlarm(), Date.parse(at))
  await made.alarm()
  assertEquals(!!(await query(made, '.fired'))[0]?.fired.at, true)
})

test('a kind is planned once an isolate, and imported again after a failure', async () => {
  let tries = 0
  let failing: Load = (plugin, name) =>
    ++tries == 1 ? Promise.reject(Error('no')) : load(plugin, name)
  assertEquals(planned(config, load), planned(config, load))
  let plan = planned(config, failing)
  let failed = await plan().then(() => false, () => true)
  assertEquals([failed, typeof (await plan())], [true, 'function'])
})
