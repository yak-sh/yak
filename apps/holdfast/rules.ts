/** Pure decisions over graph snapshots. Only the elected page applies step and purchase commands. */
import {
  along,
  arrivals,
  shotFlight,
  takenBy,
  through,
  uuidOf,
} from '@yaks/game'
import type { Creep, Point, Row, TowerDesign } from './model.ts'

export const towerId = (run: string, slot: number) =>
  uuidOf(`${run}/slot/${slot}`)
export const conductorId = (run: string) => uuidOf(`${run}/conductor`)
export const pathLength = (path: Point[]) =>
  path.slice(1).reduce(
    (sum, p, i) =>
      sum + Math.hypot(p[0] - path[i][0], p[1] - path[i][1], p[2] - path[i][2]),
    0,
  )
export const view = (rows: Row[], runId: string) => {
  let run = rows.find((r) => r.entity.eid == runId && r.run)
  let mapRow = rows.find((r) => r.entity.eid == run?.run?.map && r.map_design)
  let cleared = rows.filter((r) => r.cleared?.run == runId)
  let spent = rows.filter((r) => r.spent?.run == runId)
  let conductor = rows.find((r) => r.conductor?.run == runId)
  let waves = rows.filter((r) =>
    r.wave_design && r.wave_design.map == run?.run?.map
  ).sort((
    a,
    b,
  ) => a.wave_design!.n - b.wave_design!.n)
  let wave = conductor?.conductor?.wave ??
    (1 + cleared.reduce((n, r) => Math.max(n, r.cleared!.wave), 0))
  return {
    run,
    mapRow,
    map: mapRow?.map_design,
    towers: rows.filter((r) => r.tower?.run == runId),
    creeps: rows.filter((r) => r.creep?.run == runId),
    shots: rows.filter((r) => r.shot?.run == runId),
    players: rows.filter((r) => r.player?.run == runId),
    waves,
    cleared,
    spent,
    conductor,
    wave,
    gold: (mapRow?.map_design?.gold ?? 0) +
      cleared.reduce((n, r) => n + r.cleared!.bounty, 0) -
      spent.reduce((n, r) => n + r.spent!.gold, 0),
    lives: Math.max(
      0,
      (mapRow?.map_design?.lives ?? 0) -
        cleared.reduce((n, r) => n + r.cleared!.leaked, 0) -
        (conductor?.conductor?.leaked ?? 0),
    ),
  }
}
const active = (rows: Row[], runId: string) => {
  let v = view(rows, runId)
  if (!v.run || !v.map) throw new Error('This run is not ready yet.')
  if (v.run.completed || v.lives <= 0) {
    throw new Error('This defense has ended. Start a new run.')
  }
  return v
}
const design = (rows: Row[], id: string): TowerDesign => {
  let value = rows.find((r) => r.entity.eid == id)?.tower_design
  if (!value) throw new Error('Choose a tower first.')
  return value
}
const ledger = (
  rows: Row[],
  run: string,
  tower: string,
  gold: number,
): Row => ({
  entity: {
    eid: uuidOf(
      `${run}/purchase/${rows.filter((r) => r.spent?.run == run).length}`,
    ),
  },
  $was: { spent: { gold: null } },
  spent: { run, tower, gold },
})
export const build = (
  rows: Row[],
  runId: string,
  slot: number,
  designId: string,
): Row[] => {
  let v = active(rows, runId), d = design(rows, designId)
  if (!Number.isInteger(slot) || !v.map!.slots[slot]) {
    throw new Error('Choose a marked building site.')
  }
  if (v.towers.some((r) => r.tower!.slot == slot)) {
    throw new Error('A tower already stands here.')
  }
  if (rows.some((r) => r.tower_design?.upgrade == designId)) {
    throw new Error('Build the first tier, then upgrade it.')
  }
  if (v.gold < d.cost) {
    throw new Error(`You need ${d.cost - v.gold} more gold.`)
  }
  let eid = towerId(runId, slot)
  return [{
    entity: { eid },
    tower: { run: runId, slot, design: designId, policy: 'first' },
  }, ledger(rows, runId, eid, d.cost)]
}
export const upgrade = (rows: Row[], runId: string, slot: number): Row[] => {
  let v = active(rows, runId),
    tower = v.towers.find((r) => r.tower!.slot == slot)
  if (!tower) throw new Error('There is no tower here to upgrade.')
  let next = design(rows, tower.tower!.design).upgrade
  if (!next) throw new Error('This tower is fully upgraded.')
  let d = design(rows, next)
  if (v.gold < d.cost) {
    throw new Error(`You need ${d.cost - v.gold} more gold.`)
  }
  return [
    { entity: tower.entity, tower: { ...tower.tower!, design: next } },
    ledger(rows, runId, tower.entity.eid, d.cost),
  ]
}
export const sell = (rows: Row[], runId: string, slot: number): Row[] => {
  let v = active(rows, runId),
    tower = v.towers.find((r) => r.tower!.slot == slot)
  if (!tower) throw new Error('There is no tower here to sell.')
  let investment = design(rows, tower.tower!.design).cost
  let ancestor = tower.tower!.design
  let seen = new Set<string>([ancestor])
  for (;;) {
    let previous = rows.find((r) => r.tower_design?.upgrade == ancestor)
    if (!previous?.tower_design || seen.has(previous.entity.eid)) break
    seen.add(previous.entity.eid)
    investment += previous.tower_design.cost
    ancestor = previous.entity.eid
  }
  let refund = Math.floor(Math.max(0, investment) * 0.7)
  return [
    { entity: tower.entity, $delete: true },
    ledger(rows, runId, tower.entity.eid, -refund),
  ]
}
export const startWave = (rows: Row[], runId: string, now: number): Row[] => {
  let v = active(rows, runId)
  if (v.conductor?.conductor) {
    throw new Error('The wave is already on its way.')
  }
  if (!v.waves.some((r) => r.wave_design!.n == v.wave)) {
    throw new Error('Every wave has been held.')
  }
  return [{
    entity: { eid: conductorId(runId) },
    conductor: {
      run: runId,
      wave: v.wave,
      started: now,
      spawned: 0,
      leaked: 0,
      bounty: 0,
      at: now,
    },
  }]
}

/** Advance seconds of play against the shared millisecond clock. No timer, cache or hidden state. */
export const step = (
  rows: Row[],
  runId: string,
  now: number,
  dt: number,
): Row[] => {
  let v = view(rows, runId), original = v.conductor?.conductor
  if (
    !v.map || !v.run || v.run.completed || !original || dt <= 0 ||
    !Number.isFinite(dt)
  ) return []
  let conductor = { ...original, at: now }
  // Timed relay values are refreshed by the elected page, preserving a
  // pending flight and cooldown across ownership transfer without storage.
  let changes: Row[] = [
    ...v.shots.filter((r) => r.shot!.lands > now).map((r) => ({
      entity: r.entity,
      shot: r.shot,
    })),
    ...v.towers.flatMap((r) => {
      let firing = rows.find((v) => v.entity.eid === r.entity.eid)?.firing
      return firing ? [{ entity: r.entity, firing }] : []
    }),
  ]
  let creeps = new Map(v.creeps.map((r) => [r.entity.eid, { ...r.creep! }]))
  let enemy = (c: Creep) =>
    rows.find((r) => r.entity.eid == c.design)?.enemy_design
  let point = (c: Creep) => along(v.map!.path, c.along)
  let remove = (eid: string) => {
    creeps.delete(eid)
    changes.push({ entity: { eid }, creep: null })
  }
  let due =
    arrivals(v.shots.map((r) => ({ ...r.shot!, eid: r.entity.eid })), now).due
  for (let shot of due) {
    changes.push({ entity: { eid: shot.eid }, shot: null })
    let target = creeps.get(shot.creep)
    if (!target) continue
    let center = point(target)
    let candidates = [...creeps].map(([eid, c]) => {
      let p = point(c)
      return { eid, down: c.hp <= 0, near: 0, body: { x: p[0], z: p[2] } }
    })
    let hit = shot.splash > 0
      ? takenBy(
        { shape: 'burst', far: shot.splash },
        candidates,
        { x: center[0], z: center[2], yaw: 0 },
        { reach: 0, arc: Math.PI, shot: true },
        () => 0,
        null,
        { x: center[0], z: center[2] },
      ).map((r) => r.eid)
      : [shot.creep]
    for (let eid of hit) {
      let creep = creeps.get(eid)
      if (!creep) continue
      creep.hp -= through(
        shot.damage,
        (enemy(creep)?.armour ?? 0) * (1 - (shot.pierce ?? 0)),
        2,
        1,
      )
      if (shot.slow) {
        creep.slow = creep.slow_until > now
          ? Math.max(creep.slow ?? 0, shot.slow)
          : shot.slow
        creep.slow_until = now + 2200
      }
      if (creep.hp <= 0) {
        conductor.bounty += enemy(creep)?.bounty ?? 0
        remove(eid)
      }
    }
  }
  let length = pathLength(v.map.path)
  for (let [eid, c] of creeps) {
    let d = enemy(c)
    c.along += Math.max(0, dt) * (d?.speed ?? 1) *
      (c.slow_until > now ? 1 - (c.slow ?? 0.4) : 1)
    c.at = now
    if (c.along >= length) {
      conductor.leaked++
      remove(eid)
    }
  }
  let wave = v.waves.find((r) => r.wave_design!.n == conductor.wave)
    ?.wave_design
  if (!wave) return []
  let schedule = wave.groups.flatMap((g) =>
    Array.from({ length: g.count }, () => ({ enemy: g.enemy, gap: g.gap }))
  )
  let elapsed = Math.max(0, now - conductor.started), spawnAt = 0
  for (let i = 0; i < schedule.length; i++) {
    if (i) spawnAt += schedule[i - 1].gap * 1000
    if (i < conductor.spawned || spawnAt > elapsed) continue
    let d = rows.find((r) => r.entity.eid == schedule[i].enemy)?.enemy_design
    if (!d) continue
    let eid = uuidOf(`${runId}/wave/${conductor.wave}/creep/${i}`)
    creeps.set(eid, {
      run: runId,
      design: schedule[i].enemy,
      wave: conductor.wave,
      along: 0,
      hp: Math.round(d.hp * (1 + (conductor.wave - 1) * 0.16)),
      at: now,
      slow_until: 0,
      slow: 0,
    })
    conductor.spawned = i + 1
  }
  for (let tower of v.towers) {
    let t = tower.tower!,
      d = rows.find((r) => r.entity.eid == t.design)?.tower_design
    if (!d || d.rate <= 0) continue
    let last = rows.find((r) => r.entity.eid == tower.entity.eid)?.firing?.at ??
      -Infinity
    if (now - last < 1000 / d.rate) continue
    let origin = v.map.slots[t.slot]
    if (!origin) continue
    let targets = [...creeps].filter(([, c]) => {
      let p = point(c)
      return Math.hypot(p[0] - origin[0], p[2] - origin[1]) <= d.range
    })
    targets.sort((a, b) =>
      t.policy == 'strongest'
        ? b[1].hp - a[1].hp
        : t.policy == 'nearest'
        ? Math.hypot(point(a[1])[0] - origin[0], point(a[1])[2] - origin[1]) -
          Math.hypot(point(b[1])[0] - origin[0], point(b[1])[2] - origin[1])
        : b[1].along - a[1].along
    )
    let target = targets[0]
    if (!target) continue
    let flight = shotFlight(
      [origin[0], 1.5, origin[1]],
      point(target[1]),
      d.speed,
      1,
      0,
      () => 0,
    )
    changes.push({ entity: tower.entity, firing: { run: runId, at: now } }, {
      entity: { eid: uuidOf(`${tower.entity.eid}/shot/${now}`) },
      shot: {
        run: runId,
        tower: tower.entity.eid,
        creep: target[0],
        lands: now + Math.max(50, flight.ms),
        damage: d.damage,
        splash: d.splash,
        slow: d.slow,
        pierce: d.pierce ?? 0,
      },
    })
  }
  let previousLeaks = v.cleared.reduce((n, r) => n + r.cleared!.leaked, 0)
  let defeated = previousLeaks + conductor.leaked >= v.map.lives
  if (defeated || (conductor.spawned >= schedule.length && !creeps.size)) {
    changes.push({
      entity: { eid: uuidOf(`${runId}/cleared/${conductor.wave}`) },
      cleared: {
        run: runId,
        wave: conductor.wave,
        leaked: conductor.leaked,
        bounty: conductor.bounty + (defeated ? 0 : 20 + conductor.wave * 3),
      },
    }, { entity: { eid: conductorId(runId) }, conductor: null })
    for (let eid of creeps.keys()) {
      changes.push({ entity: { eid }, creep: null })
    }
    for (let shot of v.shots) changes.push({ entity: shot.entity, shot: null })
    if (defeated || conductor.wave == v.waves.at(-1)?.wave_design?.n) {
      changes.push({ entity: v.run.entity, completed: {} })
    }
    return changes.filter((r) => !r.shot)
  }
  for (let [eid, creep] of creeps) changes.push({ entity: { eid }, creep })
  changes.push({ entity: { eid: conductorId(runId) }, conductor })
  return changes
}
