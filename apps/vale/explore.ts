// A hero's map remembers regions, one identity-keyed row per visit. Tabs
// agree through the store and keep discoveries while a write is in flight.
import { writer } from './chat.ts'
import { comp } from './bundle.ts'
import type { Bundle, Me } from './net.ts'
import { regionsFromCells } from './explore-region.ts'
import { regionOf } from './regions.ts'
import type { Spot } from './levels.ts'

type Store = {
  readonly hero: string | null
  client: { ent: (eid: string) => Bundle | undefined }
  mine: (name: string) => Bundle[]
  keep: (...bundles: Bundle[]) => void
  settled: () => boolean
}

/** A visited region, or null when a row belongs to another hero. */
export let visitedOf = (b: Bundle, hero: string): string | null => {
  let e = comp(b, 'visited_region')
  return e.player == hero && typeof e.region == 'string' && e.region
    ? e.region
    : null
}

let storage = (hero: string) => `mossvale.regions.${hero}`
let oldStorage = (hero: string) => `mossvale.explored.${hero}`
let fromTab = (key: string): unknown => {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? '[]')
  } catch {
    return []
  }
}
let tab = {
  get: (hero: string): Set<string> => {
    let ids = fromTab(storage(hero))
    let known = new Set<string>(
      Array.isArray(ids) ? ids.filter((id) => typeof id == 'string') : [],
    )
    let old = fromTab(oldStorage(hero))
    if (Array.isArray(old) && old.length) {
      let cells = old.filter((p): p is Spot =>
        Array.isArray(p) && p.length == 2 &&
        Number.isInteger(p[0]) && Number.isInteger(p[1])
      )
      for (let id of regionsFromCells(cells)) known.add(id)
      try {
        sessionStorage.setItem(storage(hero), JSON.stringify([...known]))
        sessionStorage.removeItem(oldStorage(hero))
      } catch { /* keep the discoveries in memory until the store answers */ }
    }
    return known
  },
  set: (hero: string, ids: Set<string>) => {
    try {
      sessionStorage.setItem(storage(hero), JSON.stringify([...ids]))
    } catch { /* the store still keeps signed-in discoveries */ }
  },
}

/** Record the region this hero enters and expose every known region. */
export let exploration = (net: Store) => {
  let me: Me | null = null
  let heroWas = ''
  let known = new Set<string>()
  let held: Bundle[] | null = null
  let heldOld: Bundle[] | null = null
  let sent = new Set<string>()
  let read = () => {
    let hero = net.hero
    if (!hero) {
      heroWas = ''
      known = new Set()
      held = null
      heldOld = null
      sent.clear()
      return
    }
    if (heroWas != hero) {
      heroWas = hero
      known = tab.get(hero)
      held = null
      heldOld = null
      sent.clear()
    }
    let next = net.mine('visited_region')
    let old = net.mine('explored')
    if (held == next && heldOld == old) return
    held = next
    heldOld = old
    let changed = false
    for (let b of next) {
      let id = visitedOf(b, hero)
      if (!id) continue
      sent.add(id)
      if (!known.has(id)) changed = true
      known.add(id)
    }
    let cells: Spot[] = []
    for (let b of old) {
      let e = comp(b, 'explored')
      if (
        e.player == hero && typeof e.x == 'number' &&
        typeof e.z == 'number' && Number.isInteger(e.x) &&
        Number.isInteger(e.z)
      ) cells.push([e.x, e.z])
    }
    for (let id of regionsFromCells(cells)) {
      if (!known.has(id)) changed = true
      known.add(id)
    }
    if (changed) {
      known = new Set(known)
      tab.set(hero, known)
    }
  }
  return {
    me: (who: Me) => me = who,
    known: (): ReadonlySet<string> => {
      read()
      return known
    },
    tick: (f: { body: { x: number; z: number }; down: boolean }) => {
      let hero = net.hero
      if (!hero || f.down) return
      read()
      let id = regionOf(f.body.x, f.body.z)
      if (!known.has(id)) {
        known.add(id)
        known = new Set(known)
        tab.set(hero, known)
      }
      // A newly made hero has no created stamp until the store answers it.
      if (
        !net.settled() || writer(net.client.ent(hero)) != me?.person ||
        !me?.writes
      ) return
      for (let id of known) {
        if (sent.has(id)) continue
        sent.add(id)
        net.keep({
          entity: { eid: `$visited-region-${hero}-${id}` },
          visited_region: { player: hero, region: id },
        })
      }
    },
  }
}
