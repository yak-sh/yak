// Props and nodes that reach across a chunk seam keep distinct depth planes.
import { assertEquals } from '@std/assert'
import { LODES } from './gather.ts'
import { groundChunk } from './ground.ts'
import { fights, out, pack, place } from './mesh.ts'
import { modelOf } from './nodes.ts'
import { model } from './props.ts'
import { among, off, propAt, step, thingAt } from './stand.ts'
import { flat, standAt } from './terrain.ts'

Deno.test('adjacent crowns and a gathering node do not fight the ground or each other', () => {
  let props = [15.25, 16.25].map((x, seed) => ({
    kind: 'oak',
    x,
    z: 8.25,
    seed,
  }))
  let v = flat(5, [], props, 1)
  let o = groundChunk(v.grow(0, 0), out())
  for (let p of props) {
    let d = off(step(v, p))
    place(o, model(p.kind, p.seed), [
      p.x + d[0],
      standAt(v, p) + d[1],
      p.z + d[2],
    ])
  }
  let at: [number, number, number] = [15.75, 5, 8.25]
  let node = modelOf(LODES.oak.look, true, 0)
  let d = off(among(v)(at, [node]))
  place(o, node, [at[0] + d[0], at[1] + d[1], at[2] + d[2]])
  assertEquals(fights(pack(o)), [])
})

Deno.test('prop spacing profiles follow their drawn faces', () => {
  for (
    let [kind, seed, turn] of [
      ['oak', 1, 0],
      ['rock', 3, 1],
      ['hall.plaster', 2, 0],
      ['hall.plaster', 2, 3],
    ] as const
  ) {
    let p = { kind, x: 64.25, z: 64.25, seed, turn }
    let v = flat(5, [], [p])
    let at: [number, number, number] = [p.x, standAt(v, p), p.z]
    assertEquals(
      propAt(v, p)[0],
      thingAt(at, [model(p.kind, p.seed, p.turn)], v.voxel)[0],
    )
  }
})
