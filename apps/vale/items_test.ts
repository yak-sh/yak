// No thing's look draws two faces the depth buffer cannot tell apart (mesh.ts
// `fights`): arms and armour of every tier, what is gathered, and loot, as
// each lies on the ground and flies to a hero (items.ts `meshed`).
import { assertEquals } from '@std/assert'
import { ITEMS, meshed } from './items.ts'
import { fights, pack } from './mesh.ts'

Deno.test('no look fights itself', () => {
  let fighting = Object.entries(ITEMS)
    .map(([kind, t]) => [kind, fights(pack(meshed(t.look))).length])
    .filter(([, n]) => n)
  assertEquals(Object.fromEntries(fighting), {})
})
