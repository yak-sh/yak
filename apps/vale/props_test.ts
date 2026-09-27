// No prop draws two faces the depth buffer cannot tell apart (mesh.ts
// `fights`): every kind that stands on the ground, the village's buildings
// among them, in its first shape.
import { assertEquals } from '@std/assert'
import { fights, pack } from './mesh.ts'
import { KINDS, model } from './props.ts'

Deno.test('no prop fights itself', () => {
  let fighting = Object.keys(KINDS)
    .map((kind) => [kind, fights(pack(model(kind, 0))).length])
    .filter(([, n]) => n)
  assertEquals(Object.fromEntries(fighting), {})
})
