// Natural world props and placed lodes share a gathering lifecycle, while
// rarity and a hero's skill affect what one life is worth.
import { assert, assertEquals } from '@std/assert'
import {
  effort,
  GATHER,
  gatherXp,
  haulOf,
  LODES,
  nodeRarity,
  nodesNear,
} from './gather.ts'
import { fallOf } from './rules.ts'
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
  let at = 1000, rows = [{ at }]
  let life = (now: number) => fallOf(rows, GATHER.wood.respawn, now)
  assertEquals(life(at + 1).down, true)
  assertEquals(life(at + 59 * 60 * 1000).down, true)
  assertEquals(life(at + 60 * 60 * 1000).down, false)
  rows.push({ at: at + 60 * 60 * 1000 })
  assertEquals(life(at + 60 * 60 * 1000 + 1).down, true)
  assertEquals(nodeRarity('tree', at), nodeRarity('tree', at))
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
