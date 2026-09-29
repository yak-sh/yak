// Ground a hero has reached. Each visited cell is one identity-keyed row, so
// two tabs exploring the same ground agree without replacing each other's map.
// A tab remembers discoveries until the store catches up, as it does fires.
import { writer } from './chat.ts'
import { type Bundle, comp, type Me } from './net.ts'
import type { Spot } from './levels.ts'

// Metres per recorded step and the reach revealed around each one.
export let CELL = 20
export let REACH = 28

type Store = {
  readonly hero: string | null
  client: { ent: (eid: string) => Bundle | undefined }
  mine: (name: string) => Bundle[]
  keep: (...bundles: Bundle[]) => void
  settled: () => boolean
}

let cell = (x: number, z: number): Spot => [
  Math.floor(x / CELL),
  Math.floor(z / CELL),
]
let key = (x: number, z: number) => `${x},${z}`
let spot = (x: number, z: number): Spot => [
  (x + 0.5) * CELL,
  (z + 0.5) * CELL,
]

/** A visited cell, or null when a row belongs to another hero or is invalid. */
export let exploredOf = (b: Bundle, hero: string): Spot | null => {
  let e = comp(b, 'explored')
  return e.player == hero && typeof e.x == 'number' &&
      typeof e.z == 'number' && Number.isInteger(e.x) && Number.isInteger(e.z)
    ? [e.x, e.z]
    : null
}

let storage = (hero: string) => `mossvale.explored.${hero}`
let tab = {
  get: (hero: string): Spot[] => {
    try {
      let rows: unknown = JSON.parse(
        sessionStorage.getItem(storage(hero)) ?? '[]',
      )
      return Array.isArray(rows)
        ? rows.filter((p): p is Spot =>
          Array.isArray(p) && p.length == 2 &&
          Number.isInteger(p[0]) && Number.isInteger(p[1])
        )
        : []
    } catch {
      return []
    }
  },
  set: (hero: string, cells: Iterable<Spot>) => {
    try {
      sessionStorage.setItem(storage(hero), JSON.stringify([...cells]))
    } catch { /* the store still keeps signed-in discoveries */ }
  },
}

/** A map position that has been uncovered by walking near it. */
export let revealed = (at: Spot, around: Iterable<Spot>): boolean => {
  for (let p of around) {
    let dx = at[0] - p[0], dz = at[1] - p[1]
    if (dx * dx + dz * dz <= (REACH - 2) ** 2) return true
  }
  return false
}

/** Discovered circles that can touch the square chart on show. A moving
 * hero adds a cell through `tick`, so the chart never needs a temporary
 * circle that would vanish on their next step. */
export let mapped = (
  explored: ReadonlyArray<Spot>,
  [x0, z0, size]: [number, number, number],
): Spot[] =>
  explored.filter(([x, z]) =>
    x + REACH >= x0 && x - REACH <= x0 + size &&
    z + REACH >= z0 && z - REACH <= z0 + size
  )

/** Record the cells this hero walks through and expose them to the map. */
export let exploration = (net: Store) => {
  let me: Me | null = null
  let heroWas = ''
  let known = new Map<string, Spot>()
  let points: Spot[] = []
  let held: Bundle[] | null = null
  let sent = new Set<string>()
  let add = (p: Spot) => {
    let id = key(...p)
    if (known.has(id)) return false
    known.set(id, p)
    points = [...points, spot(...p)]
    return true
  }
  let read = () => {
    let hero = net.hero
    if (!hero) return
    if (heroWas != hero) {
      heroWas = hero
      known = new Map()
      points = []
      held = null
      sent.clear()
      for (let p of tab.get(hero)) add(p)
    }
    let next = net.mine('explored')
    if (held == next) return
    held = next
    let changed = false
    for (let b of next) {
      let p = exploredOf(b, hero)
      if (!p) continue
      sent.add(key(...p))
      changed = add(p) || changed
    }
    if (changed) tab.set(hero, known.values())
  }
  return {
    me: (who: Me) => me = who,
    known: (): ReadonlyArray<Spot> => {
      read()
      return points
    },
    tick: (f: { body: { x: number; z: number }; down: boolean }) => {
      let hero = net.hero
      if (!hero || f.down) return
      read()
      let p = cell(f.body.x, f.body.z)
      if (add(p)) tab.set(hero, known.values())
      // A newly made hero has no created stamp until the store answers it.
      // Send any tab discoveries then, including ones made before sign-in.
      if (
        !net.settled() || writer(net.client.ent(hero)) != me?.person ||
        !me?.writes
      ) return
      for (let [id, p] of known) {
        if (sent.has(id)) continue
        sent.add(id)
        net.keep({
          entity: { eid: `$explored-${hero}-${id}` },
          explored: { player: hero, x: p[0], z: p[1] },
        })
      }
    },
  }
}
