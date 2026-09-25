// Local inference must prove a complete physical set. Unknown projected sets
// use batched, addressed one-shots, never the graph-wide descriptor catalogue.
import './testing.ts'
import { effect } from '@preact/signals'
import { assertEquals, assertStrictEquals } from '@std/assert'
import { eidOf } from '@yaks/archetype'
import { archetypeTables, rememberArchetype } from './live_archetypes.ts'
import { applyLocal, type Comps, config, landSub, useRoute } from './live.ts'

let tick = () => new Promise((r) => setTimeout(r, 0))

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
