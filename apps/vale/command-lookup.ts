// Command suggestions drawn from the same registries execution resolves.
import type { Lookup } from '@yaks/cli/grammar'
import { comp } from './bundle.ts'
import { LEVELS } from './levels.ts'
import type { Net } from './net.ts'
import { GIVERS } from './quests.ts'
import { creatureNamed } from './spawn.ts'

export let commandLookup = (net: Pick<Net, 'client'>) => {
  let beasts = net.client.watch('.beast_design', { remote: false })
  let keys = net.client.watch('.alias&.key', { remote: false })
  let places = net.client.watch('.position', { remote: false })
  let lookup = {
    ids: (component: string, _prefix = '') => {
      if (component == 'theme_design') {
        return Object.values(LEVELS).flatMap((l) => [l.id, l.name])
      }
      if (component == 'position') {
        // Villagers have a worker-resolved position even without a cached row.
        // Hero names need the store's latest looks, not a partial local cache.
        return [
          ...places.value.map((b) => b.entity.eid),
          ...GIVERS.flatMap((g) => [g.id, g.name]),
        ]
      }
      if (component != 'beast_design') return []
      let eids = new Set(beasts.value.map((b) => b.entity.eid))
      let candidates = [
        ...beasts.value.flatMap((b) => {
          let name = comp(b, 'beast_design').name
          return [b.entity.eid, ...(typeof name == 'string' ? [name] : [])]
        }),
        ...keys.value.flatMap((b) => {
          let { of, value } = comp(b, 'key')
          return typeof of == 'string' && eids.has(of) &&
              typeof value == 'string'
            ? [value, value.slice(value.lastIndexOf(':') + 1)]
            : []
        }),
      ]
      return [...new Set(candidates)].filter((word) => {
        try {
          return creatureNamed(word, beasts.value, keys.value) != null
        } catch {
          // A shared name or alias tail is rejected by /spawn as ambiguous.
          return false
        }
      })
    },
  } satisfies Lookup
  return {
    lookup,
    close: () => {
      beasts.close()
      keys.close()
      places.close()
    },
  }
}
