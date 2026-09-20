// Local inference must prove a complete physical set. Unknown projected sets
// use batched, addressed one-shots, never the graph-wide descriptor catalogue.
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

Deno.test('projected descriptors batch, wake renderers, release, and survive eviction', async () => {
  let sent: { sub?: string; q?: string; unsub?: string }[] = []
  let prior = useRoute((f) => sent.push(f as typeof sent[number]))
  let host = config.host
  config.host = 'archetypes.test'
  let off = () => {}
  try {
    let tables = ['future_plugin', 'task'], id = eidOf(tables)
    let other = ['future_plugin_two'], id2 = eidOf(other)
    let seen: (readonly string[] | undefined)[] = []
    off = effect(() => {
      seen.push(archetypeTables(id))
    })
    archetypeTables(id)
    archetypeTables(id2)
    await tick()
    let requests = sent.filter((f) => f.q)
    assertEquals(requests.length, 1)
    let sub = requests[0].sub!
    assertEquals(requests[0].q, `id=${id},${id2}&.fields=archetype.tables`)
    landSub({
      sub,
      replace: true,
      fields: [{ comp: 'archetype', prop: 'tables', wake: true }],
      changes: [
        ...[[id, tables], [id2, other]].flatMap(([eid, names]) => [
          { eid: eid as string, name: 'entity', comp: { eid } },
          {
            eid: eid as string,
            name: 'archetype',
            comp: { tables: JSON.stringify(names) },
          },
        ]),
      ],
    })
    await tick()
    assertEquals(seen.at(-1), tables)
    assertEquals(sent.filter((f) => f.unsub == sub).length, 1)
    applyLocal([
      { eid: id, name: 'retired', comp: {} },
      { eid: id2, name: 'entity', comp: null },
    ])
    assertEquals(archetypeTables(id), tables)
    assertEquals(archetypeTables(id2), other)
    await tick()
    assertEquals(sent.filter((f) => f.q).length, 1)
  } finally {
    off()
    config.host = host
    useRoute(prior)
  }
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
