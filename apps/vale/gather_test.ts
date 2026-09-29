// Natural world props and placed lodes share a gathering lifecycle, while
// rarity and a hero's skill affect what one life is worth.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import {
  effort,
  GATHER,
  gatherXp,
  haulOf,
  LODES,
  naturalEid,
  nodeLife,
  nodeName,
  nodeRarity,
  nodesNear,
  respawnOf,
  yieldOf,
} from './gather.ts'
import { natureMesh } from './nature_mesh.ts'
import type { Natural } from './nature.ts'
import { flat, type Prop, propsIn } from './terrain.ts'
import { comp } from './bundle.ts'
import type { Bundle } from './net.ts'
import { type WorkFrame, working } from './work.ts'
import { seedBuildings } from './buildings_fixture.ts'
import { seedDesigns } from './designs_fixture.ts'
import { seedThemes } from './themes_fixture.ts'

seedDesigns()
seedThemes()
seedBuildings()

test('a natural prop is the same gatherable node on every read', () => {
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

test('a rock is named for its form even when its haul is the same', () => {
  assertEquals(nodeName(LODES.copper, { kind: 'rock' }), 'Stone')
  assertEquals(nodeName(LODES.copper, { kind: 'cairn' }), 'Cairn')
  assertEquals(nodeName(LODES.copper, { kind: 'menhir' }), 'Standing stone')
  assertEquals(nodeName(LODES.copper), 'Stone')
})

test('one rock life gives the same possible mineral to a player and companion', () => {
  let x = Array.from({ length: 100 }, (_, i) => i + 5).find((x) =>
    yieldOf(
      naturalEid({ kind: 'rock', x, z: 5, seed: 1, natural: true }),
      0,
      LODES.copper,
    ) == 'shard'
  )!
  let prop: Prop = { kind: 'rock', x, z: 5, seed: 1, natural: true }
  let natural: Natural[] = [{ prop, at: [x, 5, 5] }]
  let eid = naturalEid(prop), v = flat(5, [], [prop])
  let work = (hero: string, now: number, directive?: string) => {
    let rows: Bundle[] = []
    let toil = working({
      hero,
      mine: () => rows,
      gathered: () => rows,
      keep: (...bundles: Bundle[]) => {
        rows = [...rows, ...bundles]
      },
    })
    let frame: WorkFrame = {
      body: { x: x - 1, y: 5, z: 5 },
      sheet: { bag: [], worn: {} },
      down: false,
      now,
    }
    let as = directive ? { target: eid, directive } : undefined
    assert(toil.tick(v, frame, true, false, natural, as).doing)
    frame.now += effort(LODES.copper, 1)
    let events = toil.tick(v, frame, false, false, natural, as).events
    return { rows, got: events.find((e) => e.type == 'got') }
  }
  let player = work('player', 1000)
  let companion = work('player', 2000, 'order')
  assertEquals(player.rows.length, 1)
  assertEquals(comp(player.rows[0], 'item').kind, 'shard')
  assertEquals(comp(companion.rows[0], 'item').kind, 'shard')
  assertEquals(comp(player.rows[0], 'gathered').node, eid)
  assertEquals(comp(companion.rows[0], 'gathered').directive, 'order')
  assertEquals(player.got?.type == 'got' && player.got.item, 'shard')
  assertEquals(companion.got?.type == 'got' && companion.got.item, 'shard')
  assertEquals(
    comp(player.rows[0], 'gathered').xp,
    comp(companion.rows[0], 'gathered').xp,
  )
  assertEquals(
    new Set(
      Array.from(
        { length: 100 },
        (_, i) => yieldOf(`stone-${i}`, 0, LODES.copper),
      ),
    ),
    new Set(['copper', 'shard']),
  )
})

test('a harvested tree stays spent for everyone until its next life', () => {
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

test('spent resources do not capture gathering interaction', () => {
  let close: Prop = { kind: 'oak', x: 5, z: 5, seed: 1, natural: true }
  let farther: Prop = { kind: 'oak', x: 6, z: 5, seed: 2, natural: true }
  let natural: Natural[] = [close, farther].map((prop) => ({
    prop,
    at: [prop.x, 5, prop.z],
  }))
  let rows: Bundle[] = []
  let toil = working({
    hero: 'hero',
    mine: () => [],
    gathered: () => rows,
    keep: (...bundles: Bundle[]) => rows = [...rows, ...bundles],
  })
  let v = flat(5, [], [close, farther])
  let frame: WorkFrame = {
    body: { x: 4.5, y: 5, z: 5 },
    sheet: { bag: [], worn: {} },
    down: false,
    now: 1000,
  }
  let spend = (prop: Prop) => {
    rows = [...rows, {
      entity: { eid: crypto.randomUUID() },
      gathered: { node: naturalEid(prop), kind: 'oak', at: 999 },
    }]
  }
  spend(close)
  let available = toil.tick(v, frame, true, false, natural)
  assertEquals(available.near?.eid, naturalEid(farther))
  assertEquals(available.doing?.node?.eid, naturalEid(farther))

  spend(farther)
  let spent = toil.tick(v, frame, false, true, natural)
  assertEquals(spent.near, null)
  assertEquals(spent.doing, null)
  assertEquals(toil.tick(v, frame, true, false, natural).events, [
    { type: 'say', text: 'Nothing to gather here.' },
  ])
})

test('node respawns are shared, varied, and never short', () => {
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

test('skill slows hard gathering and rarity raises its rewards', () => {
  let lode = LODES.spruce
  assert(effort(lode, 1) > effort(lode, 7) * 5)
  assert(gatherXp(lode.tier, 'common', 1) < gatherXp(lode.tier, 'common', 7))
  assert(gatherXp(lode.tier, 'rare', 1) > gatherXp(lode.tier, 'common', 1))
  assert(
    haulOf('tree', 1000, 'hero', 'spruce', 1, 'rare') >
      haulOf('tree', 1000, 'hero', 'spruce', 1, 'common'),
  )
})

test('a natural resource changes shape when spent and shines when rare', () => {
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
