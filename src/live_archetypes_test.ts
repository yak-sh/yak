// Boot readiness is the addressed descriptor reply, not the working-set seed.
// New and retired descriptors remain available to projected web/TUI entities.
import { assertEquals, assertStrictEquals } from '@std/assert'
import { eidOf } from '@yaks/archetype'
import { archetypeTables, bootArchetypes } from './live_archetypes.ts'
import { ent, landSub, unsubscribe, useRoute } from './live.ts'

Deno.test('one boot subscription waits for descriptors and learns later sets', async () => {
  let sent: unknown[] = []
  let prior = useRoute((f) => sent.push(f))
  try {
    let ready = false
    let boot = bootArchetypes()
    assertStrictEquals(bootArchetypes(), boot)
    boot.then(() => ready = true)
    await Promise.resolve()
    assertEquals(ready, false)
    let tables = ['doc', 'task'], eid = eidOf(tables)
    landSub({
      sub: 'archetypes',
      replace: true,
      changes: [
        { eid, name: 'entity', comp: { eid } },
        { eid, name: 'archetype', comp: { tables: JSON.stringify(tables) } },
        { eid, name: 'retired', comp: {} },
      ],
    })
    await boot
    assertEquals(archetypeTables(eid), tables)
    let next = ['plugin_table'], id = eidOf(next)
    landSub({
      sub: 'archetypes',
      changes: [
        { eid: id, name: 'entity', comp: { eid: id } },
        { eid: id, name: 'archetype', comp: { tables: JSON.stringify(next) } },
      ],
    })
    assertEquals(archetypeTables(id), next)
    landSub({
      sub: 'projected',
      replace: true,
      changes: [
        {
          eid: 'owner',
          name: 'entity',
          comp: { eid: 'owner', archetype: eid },
        },
      ],
    })
    assertEquals((ent('owner').entity as { archetype: string }).archetype, eid)
    assertEquals(
      sent.filter((f) => (f as { q?: string }).q == '.archetype!').length,
      1,
    )
  } finally {
    unsubscribe('projected')
    unsubscribe('archetypes')
    useRoute(prior)
  }
})
