// The village fires a hero has reached. Each discovery is one identity-keyed
// row, so two visits to the same fire agree on one fact. A signed-out hero's
// discoveries stay in this tab, as their last-seen spot does (seen.ts).
import { writer } from './chat.ts'
import { comp } from './bundle.ts'
import type { Bundle, Me } from './net.ts'
import { type Village, villageOf, villagesNear } from './terrain.ts'

// Close enough to tend a fire, in metres.
let REACH = 8

type Store = {
  readonly hero: string | null
  client: { ent: (eid: string) => Bundle | undefined }
  mine: (name: string) => Bundle[]
  keep: (...bundles: Bundle[]) => void
}

export let fireNear = (x: number, z: number): Village | null =>
  villagesNear(x, z, REACH)[0] ?? null

/** A fire one may travel to from another village fire. */
export let destination = (
  x: number,
  z: number,
  known: ReadonlySet<string>,
  to: string,
): Village | null => {
  let from = fireNear(x, z)
  return from && from.level != to && known.has(to) ? villageOf(to) : null
}

let key = (hero: string) => `mossvale.fires.${hero}`
let tab = {
  get: (hero: string): string[] => {
    try {
      let rows: unknown = JSON.parse(sessionStorage.getItem(key(hero)) ?? '[]')
      return Array.isArray(rows)
        ? rows.filter((id): id is string =>
          typeof id == 'string' && !!villageOf(id)
        )
        : []
    } catch {
      return []
    }
  },
  set: (hero: string, ids: ReadonlySet<string>) => {
    try {
      sessionStorage.setItem(key(hero), JSON.stringify([...ids]))
    } catch { /* a tab without storage starts its discoveries again */ }
  },
}

/** Discover fires as the hero reaches them; keep signed-in discoveries in
 * the store and a tab copy for the hero made while signed out. */
export let fires = (net: Store) => {
  let me: Me | null = null
  let sent = new Set<string>()
  let heroWas = ''
  let tabbed = new Set<string>()
  let known = (): Set<string> => {
    let hero = net.hero
    if (!hero) return new Set()
    if (heroWas != hero) {
      heroWas = hero
      tabbed = new Set(tab.get(hero))
      sent.clear()
    }
    let before = tabbed.size
    for (let b of net.mine('fire')) {
      let row = comp(b, 'fire')
      if (
        row.player == hero && typeof row.village == 'string' &&
        villageOf(row.village)
      ) tabbed.add(row.village)
    }
    if (tabbed.size != before) tab.set(hero, tabbed)
    return new Set(tabbed)
  }
  return {
    me: (who: Me) => {
      me = who
    },
    known,
    tick: (
      f: { body: { x: number; z: number }; down: boolean },
    ): Village | null => {
      let hero = net.hero
      if (!hero || f.down) return null
      let visited = known()
      let near = fireNear(f.body.x, f.body.z)
      let found = near && !visited.has(near.level) ? near : null
      if (found) {
        visited.add(found.level)
        tabbed.add(found.level)
        tab.set(hero, visited)
      }
      // A newly made hero may not have its created stamp yet. Once it does,
      // the same tab discoveries can be written on its behalf.
      if (writer(net.client.ent(hero)) == me?.person && me?.writes) {
        for (let id of visited) {
          if (
            sent.has(id) || net.mine('fire').some((b) => {
              let row = comp(b, 'fire')
              return row.player == hero && row.village == id
            })
          ) continue
          sent.add(id)
          net.keep({
            entity: { eid: `$fire-${hero}-${id}` },
            fire: { player: hero, village: id },
          })
        }
      }
      return found
    },
  }
}
