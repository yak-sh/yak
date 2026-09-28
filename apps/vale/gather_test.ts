// Natural world props and placed lodes share a gathering lifecycle, while
// rarity and a hero's skill affect what one life is worth.
import { assert, assertEquals } from '@std/assert'
import {
  effort,
  GATHER,
  gatherXp,
  haulOf,
  LODES,
  nodeLife,
  nodeRarity,
  nodesNear,
  respawnOf,
} from './gather.ts'
import { natureMesh } from './nature_mesh.ts'
import type { Natural } from './nature.ts'
import { propsIn } from './terrain.ts'

Deno.test('a natural prop is the same gatherable node on every read', () => {
  let prop = propsIn(2, 2).find((p) => p.natural)!
  let find = () =>
    nodesNear(prop.x, prop.z, 3, [{ prop, at: [prop.x, 5, prop.z] }])
      .find((n) => n.prop == prop)!
  let first = find()
  assert(first)
  assertEquals(find().eid, first.eid)
  assertEquals([first.x, first.z], [prop.x, prop.z])
  assert(LODES[first.lode])
})

Deno.test('a harvested tree stays spent for everyone until its next life', () => {
  let at = 1000, eid = 'tree', rows = [{ at }]
  let life = (now: number) => nodeLife(rows, eid, 'wood', now)
  let back = at + respawnOf(eid, 'wood', at) * 1000
  assertEquals(life(at + 1).down, true)
  assertEquals(life(back - 1).down, true)
  assertEquals(life(back).down, false)
  rows.push({ at: back })
  assertEquals(life(back + 1).down, true)
  assertEquals(life(back + 1).fell, back)
  assertEquals(nodeRarity('tree', at), nodeRarity('tree', at))
})

Deno.test('node respawns are shared, varied, and never short', () => {
  for (let trade of ['wood', 'ore', 'herb', 'fish'] as const) {
    let times = Array.from(
      { length: 24 },
      (_, n) => respawnOf(`node-${n % 8}`, trade, 1000 + n * 1000),
    )
    assert(times.every((t) => t >= GATHER[trade].respawn))
    assert(times.every((t) => t < GATHER[trade].respawn + 1800))
    assert(times.every((t) => t >= 1800))
    assert(new Set(times).size > 1)
    assertEquals(respawnOf('node', trade, 1000), respawnOf('node', trade, 1000))
  }
})

Deno.test('skill slows hard gathering and rarity raises its rewards', () => {
  let lode = LODES.spruce
  assert(effort(lode, 1) > effort(lode, 7) * 5)
  assert(gatherXp(lode.tier, 'common', 1) < gatherXp(lode.tier, 'common', 7))
  assert(gatherXp(lode.tier, 'rare', 1) > gatherXp(lode.tier, 'common', 1))
  assert(
    haulOf('tree', 1000, 'hero', 'spruce', 1, 'rare') >
      haulOf('tree', 1000, 'hero', 'spruce', 1, 'common'),
  )
})

Deno.test('a natural resource changes shape when spent and shines when rare', () => {
  let entry: Natural = {
    prop: { kind: 'oak', x: 5, z: 7, seed: 1, natural: true },
    at: [5, 5, 7],
  }
  let whole = natureMesh(
    0,
    0,
    [{ ...entry, spent: false, rarity: 'common' }],
    0.25,
  )!
  let spent = natureMesh(
    0,
    0,
    [{ ...entry, spent: true, rarity: 'common' }],
    0.25,
  )!
  let rare = natureMesh(
    0,
    0,
    [{ ...entry, spent: false, rarity: 'rare' }],
    0.25,
  )!
  let finer = natureMesh(
    0,
    0,
    [{ ...entry, spent: false, rarity: 'common' }],
    0.125,
  )!
  assert(whole.pos.length > spent.pos.length)
  assert(rare.pos.length > whole.pos.length)
  assert(finer.pos.length > whole.pos.length)
})
