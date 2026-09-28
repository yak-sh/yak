// An admin's destination in the one world. A named land starts at its arrival
// point, adjusted onto safe ground; coordinates must themselves be walkable.
// The worker validates the request before keeping it, and the page checks it
// again before moving a hero.
import { LEVELS, SIZE } from './levels.ts'
import { comp, num, str } from './bundle.ts'
import type { Bundle } from './net.ts'
import { regionOf } from './regions.ts'
import { type Body, fits, floorAt } from './sim.ts'
import { groundAt, type Vale } from './terrain.ts'
import { arriveOf } from './ways.ts'

export type Target = { level: string } | { x: number; z: number }
export type Destination = { level: string; x: number; z: number }

let CLIMB = 1.2

/** Stand on this spot, if it holds a hero. */
export let resumed = (
  v: Vale,
  s: { x: number; z: number; yaw: number },
): Body | null => {
  let y = floorAt(v, s.x, s.z, groundAt(v, s.x, s.z) + CLIMB)
  return fits(v, s.x, s.z, y)
    ? { x: s.x, y, z: s.z, vy: 0, yaw: s.yaw, speed: 0, gait: 'idle' }
    : null
}

let cells = new Set(Object.values(LEVELS).map((l) => l.cell.join(',')))
let inWorld = (x: number, z: number) =>
  cells.has(`${Math.floor(x / SIZE)},${Math.floor(z / SIZE)}`)

let safe = (v: Vale, level: string, x: number, z: number) =>
  regionOf(x, z) == level && !!resumed(v, { x, z, yaw: 0 })

/** Resolve a command to a walkable place in a known land. */
export let destinationOf = (v: Vale, target: Target): Destination => {
  if ('level' in target) {
    let { level } = target
    if (!Object.hasOwn(LEVELS, level)) {
      throw new Error(`Unknown land: ${level}.`)
    }
    let [x, z] = arriveOf(level)
    for (let radius = 0; radius <= 12; radius += 0.5) {
      for (let dx = -radius; dx <= radius; dx += 0.5) {
        for (let dz of radius ? [-radius, radius] : [0]) {
          if (safe(v, level, x + dx, z + dz)) {
            return { level, x: x + dx, z: z + dz }
          }
        }
      }
      for (let dz = -radius + 0.5; dz < radius; dz += 0.5) {
        for (let dx of [-radius, radius]) {
          if (safe(v, level, x + dx, z + dz)) {
            return { level, x: x + dx, z: z + dz }
          }
        }
      }
    }
    throw new Error(`${LEVELS[level].name} has no safe arrival point.`)
  }
  let { x, z } = target
  if (!Number.isFinite(x) || !Number.isFinite(z) || !inWorld(x, z)) {
    throw new Error('Coordinates must be finite world metres in a known land.')
  }
  let level = regionOf(x, z)
  if (!safe(v, level, x, z)) {
    throw new Error(`(${x}, ${z}) is not a walkable place.`)
  }
  return { level, x, z }
}

/** The newest request this hero has not yet answered with a seen position. */
export let nextTeleport = (
  requests: Bundle[],
  player: string,
  acknowledged: string | undefined,
  handled: string | undefined,
): Bundle | null => {
  let latest =
    requests.filter((r) =>
      comp(r, 'teleport_request').player == player &&
      Number.isFinite(Date.parse(str(comp(r, 'created').at)))
    ).sort((a, b) =>
      Date.parse(str(comp(b, 'created').at)) -
        Date.parse(str(comp(a, 'created').at)) ||
      num(b.entity.num) - num(a.entity.num) ||
      b.entity.eid.localeCompare(a.entity.eid)
    )[0] ?? null
  return latest && latest.entity.eid != acknowledged &&
      latest.entity.eid != handled
    ? latest
    : null
}
