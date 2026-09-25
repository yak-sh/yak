// Local inference must prove a complete physical set. Unknown projected sets
// use batched, addressed one-shots, never the graph-wide descriptor catalogue.
import './testing.ts'
import { assertEquals, assertStrictEquals } from '@std/assert'
import { eidOf } from '@yaks/archetype'
import { archetypeTables, rememberArchetype } from './live_archetypes.ts'
import { applyLocal, type Comps, config } from './live.ts'
import { host } from './host_testing.ts'
import { tick } from './testing.ts'
import { effect } from '@preact/signals'

Deno.test('local table names prove the spine without reading component bodies', () => {
  let tables = ['doc', 'local_plugin', 'task'], id = eidOf(tables)
  let body = new Proxy({}, {
    get: () => {
      throw Error('body read')
    },
    ownKeys: () => {
      throw Error('body enumeration')
    },
  })
  let partial = { entity: { eid: 'owner', num: 0, archetype: id }, doc: body }
  rememberArchetype(partial)
  assertEquals(archetypeTables(id), undefined)
  rememberArchetype({ ...partial, task: body, local_plugin: body })
  assertEquals(archetypeTables(id), tables)
  assertStrictEquals(archetypeTables(id), archetypeTables(id))
  // A stale union after a component removal cannot teach the new archetype.
  let next = eidOf(['task', 'local_plugin'])
  rememberArchetype({
    ...partial,
    entity: { ...partial.entity, archetype: next },
    task: body,
    local_plugin: body,
  })
  assertEquals(archetypeTables(next), undefined)
})

Deno.test('a later physical set is learned, not the prior set of the same owner', () => {
  let names = ['late_plugin'], id = eidOf(names)
  let value = {
    entity: { eid: 'moving-owner', num: 0, archetype: id },
    late_plugin: {},
  } as Comps
  rememberArchetype(value)
  assertEquals(archetypeTables(id), names)
  let next = ['late_plugin', 'task'], nextId = eidOf(next)
  rememberArchetype({
    ...value,
    entity: { ...value.entity!, archetype: nextId },
    task: {},
  })
  assertEquals(archetypeTables(nextId), next)
  assertEquals(archetypeTables(id), names)
})

Deno.test('projected descriptors batch, wake renderers, release, and survive eviction', async () => {
  let prior = config.host
  config.host = 'archetypes.test'
  let tables = ['future_plugin', 'task'], id = eidOf(tables)
  let other = ['future_plugin_two'], id2 = eidOf(other)
  let wire = host(() => ({
    bundles: ([[id, tables], [id2, other]] as const).map(([eid, names]) => ({
      entity: { eid },
      archetype: { tables: JSON.stringify(names) },
    })),
  }))
  let asks = () => wire.asked().filter((a) => a.subscribe.startsWith('.eid='))
  let off = () => {}
  try {
    let seen: (readonly string[] | undefined)[] = []
    off = effect(() => {
      seen.push(archetypeTables(id))
    })
    archetypeTables(id2)
    await tick()
    assertEquals(asks().map((a) => a.subscribe), [`.eid=${id},${id2}&*`])
    await tick()
    assertEquals(seen.at(-1), tables)
    assertEquals(
      wire.sent.filter((m) => m.unsubscribe == asks()[0].id).length,
      1,
    )
    applyLocal([
      { eid: id, name: 'retired', comp: {} },
      { eid: id2, name: 'entity', comp: null },
    ])
    assertEquals(archetypeTables(id), tables)
    assertEquals(archetypeTables(id2), other)
    await tick()
    assertEquals(asks().length, 1)
  } finally {
    off()
    config.host = prior
    wire.free()
  }
})
