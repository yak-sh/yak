// The companion's shared choices and walk, plus the page's view of its
// persisted state. The scheduled app worker owns every world-changing tick.
import { writer } from './chat.ts'
import { GATHER, LODES, naturalEid } from './gather.ts'
import { type Natural, NATURE } from './nature.ts'
import { comp, num, str } from './bundle.ts'
import type { Bundle, Net } from './net.ts'
import { fallOf } from './rules.ts'
import { fits, floorAt } from './sim.ts'
import type { Vale } from './terrain.ts'
import { walk } from './walk.ts'
import type { Work } from './work.ts'

export type Objective = { eid: string; player: string; count: number }
export type Tree = { eid: string; kind: string; x: number; z: number }
export type Choice = Tree & { path: [number, number, number][] }

/** Only the hero's owner can direct their companion. */
export let objectiveOf = (
  hero: Bundle | undefined,
  rows: Bundle[],
): Objective | null => {
  let owner = writer(hero)
  if (!hero?.player || !owner) return null
  let own = rows.filter((b) =>
    writer(b) == owner && str(comp(b, 'directive').player) == hero.entity.eid &&
    str(comp(b, 'directive').goal) == 'wood'
  )
  let row = own.sort((a, b) =>
    Date.parse(str(comp(b, 'created').at)) -
    Date.parse(str(comp(a, 'created').at))
  )[0]
  let count = num(comp(row, 'directive').count)
  return row && count >= 1 && count <= 10
    ? { eid: row.entity.eid, player: hero.entity.eid, count }
    : null
}

/** A gathered row is the progress record; it already credits the hero. */
export let progressOf = (rows: Bundle[], eid: string): number =>
  rows.filter((b) => str(comp(b, 'gathered').directive) == eid).length

/** Trees the page can see and nobody has spent in this life. */
export let treesOf = (
  x: number,
  z: number,
  natural: Natural[],
  gathered: Bundle[],
  now: number,
): Tree[] => {
  let by = new Map<string, { at: number }[]>()
  for (let b of gathered) {
    let g = comp(b, 'gathered'), eid = str(g.node)
    if (!by.has(eid)) by.set(eid, [])
    by.get(eid)!.push({ at: num(g.at) })
  }
  return natural.flatMap(({ prop }) => {
    let kind = NATURE[prop.kind], eid = naturalEid(prop)
    return prop.natural && LODES[kind]?.trade == 'wood' &&
        Math.hypot(prop.x - x, prop.z - z) < 32 &&
        !fallOf(by.get(eid) ?? [], GATHER.wood.respawn, now).down
      ? [{ eid, kind, x: prop.x, z: prop.z }]
      : []
  }).sort((a, b) =>
    Math.hypot(a.x - x, a.z - z) -
    Math.hypot(b.x - x, b.z - z)
  )
}

/** Reach a tree's side, outside its trunk but inside chopping range. */
export let routeTo = (
  v: Vale,
  from: [number, number, number],
  tree: Tree,
): Choice | null => {
  let radius = GATHER.wood.reach - 0.5
  let angle = Math.atan2(from[2] - tree.z, from[0] - tree.x)
  for (let i = 0; i < 4; i++) {
    let a = angle + i * Math.PI / 2
    let x = tree.x + radius * Math.cos(a)
    let z = tree.z + radius * Math.sin(a)
    let y = floorAt(v, x, z, from[1])
    if (!fits(v, x, z, y)) continue
    let to: [number, number, number] = [x, y, z]
    let path = walk(v, from, to)
    if (path.at(-1) == to) return { ...tree, path }
  }
  return null
}

/** Walk one frame along the same collision-aware route villagers use. */
export let advance = (
  from: [number, number, number],
  path: [number, number, number][],
  dt: number,
): { at: [number, number, number]; path: typeof path; speed: number } => {
  let left = Math.max(0, dt) * 2
  let at = from
  while (path.length && left > 0) {
    let to = path[0]
    let d = Math.hypot(to[0] - at[0], to[2] - at[2])
    if (d < 0.15) {
      at = to
      path = path.slice(1)
    } else {
      let k = Math.min(1, left / d)
      at = [
        at[0] + (to[0] - at[0]) * k,
        at[1] + (to[1] - at[1]) * k,
        at[2] + (to[2] - at[2]) * k,
      ]
      left -= d * k
      if (k == 1) path = path.slice(1)
    }
  }
  return {
    at,
    path,
    speed: dt > 0 ? Math.hypot(at[0] - from[0], at[2] - from[2]) / dt : 0,
  }
}

export type Companion = ReturnType<typeof companion>

/** The page reads the server's last tick; it never advances the world. */
export let companion = (net: Net) => ({
  tick: (
    _v: Vale,
    _f: unknown,
    _dt: number,
    _natural: Natural[],
  ): {
    at: [number, number, number] | null
    speed: number
    status: string
    events: Work[]
    swing: number
  } => {
    let hero = net.hero ? net.client.ent(net.hero) : undefined
    let objective = objectiveOf(hero, net.mine('directive'))
    let row = net.mine('directive').find((b) => b.entity.eid == objective?.eid)
    let c = comp(row, 'companion')
    let done = objective ? progressOf(net.mine('item'), objective.eid) : 0
    let at: [number, number, number] | null =
      typeof c.x == 'number' && typeof c.y == 'number' &&
        typeof c.z == 'number'
        ? [c.x, c.y, c.z]
        : null
    return {
      at,
      speed: num(c.speed),
      status: objective
        ? `Wood ${done}/${objective.count} · ${str(c.status, 'Waiting')}`
        : '',
      events: [],
      swing: -1,
    }
  },
})
