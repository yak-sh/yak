/** Rules checked at the pure graph-snapshot seam, with a supplied shared clock. */
import { equal, ok, test } from '@yaks/testing'
import { assertThrows as throws } from '@std/assert'
import type { Row } from './model.ts'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import words from './vocab.json' with { type: 'json' }
import {
  build,
  conductorId,
  pathLength,
  sell,
  startWave,
  step,
  towerId,
  upgrade,
  view,
} from './rules.ts'
import { ids, seed } from './seed.ts'

const runId = 'e223db2c-119c-458d-bdaf-7bc8a4f4b3e1'
const run: Row = {
  entity: { eid: runId },
  run: { map: ids.maps[0], seed: 42 },
}
const base: Row[] = [...seed, run]
const patch = (rows: Row[], edits: Row[]): Row[] => {
  let copy = new Map(rows.map((r) => [r.entity.eid, r]))
  for (let row of edits) {
    if (row.$delete) copy.delete(row.entity.eid)
    else copy.set(row.entity.eid, { ...copy.get(row.entity.eid), ...row })
  }
  return [...copy.values()]
}
const built = patch(base, build(base, runId, 0, ids.towers.arrow[0]))
const rich: Row[] = [...built, {
  entity: { eid: '77790a26-1a14-4ed3-8ca3-a42f8ba427d4' },
  cleared: { run: runId, wave: 1, leaked: 2, bounty: 1000 },
}]
const upgraded = patch(rich, upgrade(rich, runId, 0))
const sold = patch(upgraded, sell(upgraded, runId, 0))
const rebuilt = patch(sold, build(sold, runId, 0, ids.towers.arrow[0]))
const active = patch(base, startWave(base, runId, 1000))
const spawned = patch(active, step(active, runId, 1000, 0.05))
const short: Row[] = [
  {
    entity: { eid: ids.maps[0] },
    map_design: {
      name: 'Probe',
      path: [[0, 0, 0], [2, 0, 0]],
      slots: [[0, 1]],
      gold: 500,
      lives: 1,
    },
  },
  {
    entity: { eid: ids.enemies.runner },
    enemy_design: {
      name: 'Target',
      hp: 10,
      speed: 1,
      armour: 0,
      bounty: 5,
      figure: {},
    },
  },
  {
    entity: { eid: ids.towers.arrow[0] },
    tower_design: {
      name: 'Bow',
      cost: 50,
      range: 5,
      rate: 1,
      damage: 10,
      splash: 0,
      slow: 0,
      speed: 10,
      figure: {},
    },
  },
  {
    entity: { eid: '7fd485ee-283f-43d2-a1a8-c5c0fec2a082' },
    wave_design: {
      map: ids.maps[0],
      n: 1,
      groups: [{ enemy: ids.enemies.runner, count: 1, gap: 1 }],
    },
  },
  run,
]
const shortRunning = patch(short, startWave(short, runId, 1000))
const targetId = 'b41c505f-c124-4332-bdf3-6d9b79820c6e'
const leaking: Row[] = [...shortRunning.filter((r) => !r.conductor), {
  entity: { eid: conductorId(runId) },
  conductor: {
    run: runId,
    wave: 1,
    started: 1000,
    spawned: 1,
    leaked: 0,
    bounty: 0,
    at: 1000,
  },
}, {
  entity: { eid: targetId },
  creep: {
    run: runId,
    design: ids.enemies.runner,
    wave: 1,
    along: 1.9,
    hp: 10,
    at: 1000,
    slow_until: 0,
  },
}]
const dying: Row[] = [...leaking, {
  entity: { eid: '4d41f9b5-767c-41da-b6c6-439be780e884' },
  shot: {
    run: runId,
    tower: towerId(runId, 0),
    creep: targetId,
    lands: 1100,
    damage: 10,
    splash: 0,
    slow: 0,
  },
}]

test('a shared purse pays once and rejects another build on the same site', () => {
  let v = view(built, runId)
  equal(v.gold, 195)
  equal(v.towers[0].entity.eid, towerId(runId, 0))
  throws(() => build(built, runId, 0, ids.towers.cannon[0]))
  throws(() => build(base, runId, -1, ids.towers.arrow[0]))
  throws(() => build(base, runId, 1, ids.towers.arrow[1]))
})

test('upgrading and selling use the current tower investment, not old tower lifetimes', () => {
  equal(view(upgraded, runId).towers[0].tower!.design, ids.towers.arrow[1])
  equal(sell(upgraded, runId, 0)[1].spent!.gold, -94)
  equal(sell(rebuilt, runId, 0)[1].spent!.gold, -38)
  equal(view(sold, runId).towers.length, 0)
})

test('ledger lives and gold exclude other runs and include active leaks', () => {
  let rows: Row[] = [...rich, {
    entity: { eid: conductorId(runId) },
    conductor: {
      run: runId,
      wave: 2,
      started: 1000,
      spawned: 1,
      leaked: 3,
      bounty: 0,
      at: 1000,
    },
  }, {
    entity: { eid: '02a616d1-5d57-4315-a6e3-832e318d219d' },
    spent: { run: 'another', gold: 9000, tower: 'another' },
  }]
  equal(view(rows, runId).gold, 1195)
  equal(view(rows, runId).lives, 15)
})

test('the shared clock starts one wave and spawns reproducibly', () => {
  equal(view(spawned, runId).creeps.length, 1)
  equal(view(spawned, runId).conductor!.conductor!.spawned, 1)
  equal(step(active, runId, 1000, 0.05), step(active, runId, 1000, 0.05))
  throws(() => startWave(active, runId, 1001))
})

test('a leak is accounted in the ledger before defeat completes the run', () => {
  let after = patch(leaking, step(leaking, runId, 1250, 0.25))
  equal(view(after, runId).lives, 0)
  equal(view(after, runId).cleared[0].cleared!.leaked, 1)
  equal(view(after, runId).creeps.length, 0)
  ok(view(after, runId).run!.completed)
})

test('a due hit is resolved before movement and the final clear completes victory', () => {
  let after = patch(dying, step(dying, runId, 1250, 0.25))
  equal(view(after, runId).lives, 1)
  equal(view(after, runId).gold, 528)
  equal(view(after, runId).creeps.length, 0)
  ok(view(after, runId).run!.completed)
})

test('authored maps have playable paths and tower upgrades have valid designs', () => {
  for (let row of seed) {
    if (row.map_design) ok(pathLength(row.map_design.path) > 20)
    if (row.tower_design?.upgrade) {
      ok(
        seed.some((r) =>
          r.entity.eid == row.tower_design!.upgrade && r.tower_design
        ),
      )
    }
  }
})

const firingRows = patch(
  leaking,
  build(leaking, runId, 0, ids.towers.arrow[0]),
)
const slowedRows: Row[] = [
  ...leaking.filter((r) => !r.creep),
  {
    entity: { eid: targetId },
    creep: {
      run: runId,
      design: ids.enemies.runner,
      wave: 1,
      along: 0.5,
      hp: 100,
      at: 1000,
      slow_until: 0,
    },
  },
  {
    entity: { eid: '84a459fe-3796-4ada-a785-1ddf0870b70b' },
    creep: {
      run: runId,
      design: ids.enemies.runner,
      wave: 1,
      along: 0.8,
      hp: 100,
      at: 1000,
      slow_until: 0,
    },
  },
  {
    entity: { eid: '3d322e36-156b-4ce7-891b-6d235b0c5ab4' },
    shot: {
      run: runId,
      tower: towerId(runId, 0),
      creep: targetId,
      lands: 1001,
      damage: 10,
      splash: 1,
      slow: 0.5,
    },
  },
]

test('a tower schedules flight once and respects its shared firing clock', () => {
  let edits = step(firingRows, runId, 1001, 0.01)
  let shot = edits.find((r) => r.shot)?.shot
  ok(shot)
  ok(shot!.lands > 1001)
  equal(shot!.creep, targetId)
  let after = patch(firingRows, edits)
  let kept = step(after, runId, 1010, 0.01).filter((r) => r.shot)
  equal(
    kept.map((r) => r.entity.eid),
    edits.filter((r) => r.shot).map((r) => r.entity.eid),
  )
  equal(kept[0].shot, shot)
})

test('splash harms neighbours and slowing changes subsequent movement', () => {
  let after = patch(slowedRows, step(slowedRows, runId, 1050, 0.1))
  let mobs = view(after, runId).creeps
  equal(mobs.length, 2)
  equal(mobs[0].creep!.hp, 90)
  equal(mobs[1].creep!.hp, 90)
  equal(mobs[0].creep!.along, 0.55)
  equal(mobs[0].creep!.slow_until, 3250)
})

// A missing URL run must remain a waiting view even when designs and page-only
// rows have already arrived. In particular, absent wave_design values are not
// accidentally selected by comparing two undefined map ids.
const waitingRows: Row[] = [...seed, {
  entity: { eid: 'waiting-page' },
  Build: { slot: 0 },
}]
test('a missing run has an empty waiting view until its rows arrive', () => {
  let waiting = view(waitingRows, 'missing-run')
  equal(waiting.run, undefined)
  equal(waiting.map, undefined)
  equal(waiting.waves, [])
  equal(waiting.gold, 0)
  equal(waiting.lives, 0)
  equal(step(waitingRows, 'missing-run', 1000, 0.05), [])
})

const keptFlightId = '7eff4b0d-2a06-48a1-a523-710279c58793'
const keptFlight = {
  run: runId,
  tower: towerId(runId, 0),
  creep: targetId,
  lands: 8000,
  damage: 10,
  splash: 0,
  slow: 0,
}
const handoffRows: Row[] = patch(firingRows, [{
  entity: { eid: keptFlightId },
  shot: keptFlight,
}, {
  entity: { eid: towerId(runId, 0) },
  tower: firingRows.find((r) => r.tower)!.tower,
  firing: { run: runId, at: 990 },
}])
test('the elected page refreshes a pending flight and firing clock without changing them', () => {
  let edits = step(handoffRows, runId, 1001, 0.01)
  equal(edits.find((r) => r.entity.eid === keptFlightId)?.shot, keptFlight)
  equal(edits.filter((r) => r.shot).length, 1)
  equal(edits.find((r) => r.entity.eid === towerId(runId, 0))?.firing, {
    run: runId,
    at: 990,
  })
  equal(edits.find((r) => r.conductor)?.conductor?.at, 1001)
  equal(edits.find((r) => r.creep)?.creep?.at, 1001)
})

// Both pages can decide against the same affordable snapshot before learning
// who owns the simulation. The emitted ledger guard makes that race one
// transaction: the losing tower must not survive its stale purse write.
const contested: Row[] = base.map((r) =>
  r.map_design ? { ...r, map_design: { ...r.map_design, gold: 80 } } : r
)
const firstPurchase = build(contested, runId, 0, ids.towers.arrow[0])
const stalePurchase = build(contested, runId, 1, ids.towers.arrow[0])
const moneyWords = loadVocab([words, {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      properties: { num: { type: 'number', stamped: true } },
    },
  },
}])
const purse = graph({ vocab: moneyWords, storage: ram(moneyWords) })
const sync = (batch: Row[]) => {
  let out = purse.apply(batch as Bundle[])
  if (!Array.isArray(out)) {
    throw new Error('The RAM purse must apply synchronously.')
  }
  return out
}
sync(contested)
sync(firstPurchase)
test('competing purchases use one guarded ledger position across different sites', () => {
  equal(firstPurchase[1].entity.eid, stalePurchase[1].entity.eid)
  throws(() => sync(stalePurchase))
  equal(purse.get([towerId(runId, 1)]), [])
  let ledger = (purse.get([firstPurchase[1].entity.eid]) as Bundle[])[0]
  equal((ledger.spent as { gold: number }).gold, 55)
})
