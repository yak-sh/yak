// No prop draws two faces the depth buffer cannot tell apart (mesh.ts
// `fights`): every kind that stands on the ground, the village's buildings
// among them, in its first shape.
import { assert, assertEquals, assertStrictEquals } from '@std/assert'
import { fights, key, pack, profileOf, unkey } from './mesh.ts'
import { KINDS, model, modelKey } from './props.ts'
import { walk } from './sim.ts'
import { groundAt, hearthNear, propsNear, vale } from './terrain.ts'
import { seedThemes } from './themes_fixture.ts'

seedThemes()

Deno.test('no prop fights itself', () => {
  let fighting = Object.keys(KINDS)
    .map((kind) => [kind, fights(pack(model(kind, 0))).length])
    .filter(([, n]) => n)
  assertEquals(Object.fromEntries(fighting), {})
})

Deno.test('finer tree and rock voxels keep their outline and share each mesh', () => {
  for (let kind of ['oak', 'rock', 'shorepine']) {
    for (let turn = 0; turn < 4; turn++) {
      let base = model(kind, 1, turn)
      let fine = model(kind, 1, turn, true, 0.125)
      let small = model(kind, 1, turn, true, 0.25)
      let chunky = model(kind, 1, turn, true, 2)
      assertEquals(profileOf(fine).room, profileOf(base).room)
      assertEquals(profileOf(chunky).room, profileOf(base).room)
      assert(fine.idx.length > base.idx.length)
      assertEquals([fine.bw[2], small.bw[2], chunky.bw[2]], [0.125, 0.25, 2])
      assertEquals(fights(pack(fine)), [])
      assertStrictEquals(fine, model(kind, 1, turn, true, 0.125))
      assert(
        modelKey(kind, 1, turn, true, 0.125) !=
          modelKey(kind, 1, turn),
      )
    }
  }
  assertStrictEquals(model('well', 1, 0, true, 0.125), model('well', 1))
})

Deno.test('the well has no pieces hanging apart from its footing', () => {
  let unseen = new Set(KINDS.well.make(0).vox.keys())
  while (unseen.size) {
    let first = unseen.values().next().value!
    let queue = [first], grounded = false
    unseen.delete(first)
    for (let k of queue) {
      let [x, y, z] = unkey(k)
      if (y == 0) grounded = true
      for (
        let [dx, dy, dz] of [
          [1, 0, 0],
          [-1, 0, 0],
          [0, 1, 0],
          [0, -1, 0],
          [0, 0, 1],
          [0, 0, -1],
        ]
      ) {
        let neighbor = key(x + dx, y + dy, z + dz)
        if (unseen.delete(neighbor)) queue.push(neighbor)
      }
    }
    assert(grounded)
  }
})

Deno.test('a hero jumps across the village fire but cannot run through it', () => {
  let v = vale(), hearth = hearthNear(0, 0)!
  let fire = propsNear(v, ...hearth, 5).find((p) => p.kind == 'fire')!
  let run = (jump: boolean) => {
    let body = {
      x: fire.x - 1.6,
      y: groundAt(v, fire.x - 1.6, fire.z),
      z: fire.z,
      vy: 0,
      yaw: 0,
      speed: 0,
      gait: 'idle',
    }
    for (let i = 0; i < 60; i++) {
      body = walk(v, body, { x: 1, z: 0, jump: jump && i == 0 }, 1 / 60, 5)
    }
    return body.x
  }
  assert(run(false) < fire.x - 1)
  assert(run(true) > fire.x + 1.5)
})
