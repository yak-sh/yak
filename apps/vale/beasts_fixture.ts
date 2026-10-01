// Tests install the same rows a new app store receives from its seed.
import { useBeasts, useDens } from './beasts.ts'
import { useNames } from './names.ts'
import deep from './seed/beasts/deep.json' with { type: 'json' }
import fire from './seed/beasts/fire.json' with { type: 'json' }
import frost from './seed/beasts/frost.json' with { type: 'json' }
import heights from './seed/beasts/heights.json' with { type: 'json' }
import meadow from './seed/beasts/meadow.json' with { type: 'json' }
import sands from './seed/beasts/sands.json' with { type: 'json' }
import waters from './seed/beasts/waters.json' with { type: 'json' }
import woods from './seed/beasts/woods.json' with { type: 'json' }
import sounds from './seed/sounds.json' with { type: 'json' }
import type { Bundle } from './net.ts'

export let rows: Bundle[] = [
  ...sounds,
  ...meadow,
  ...woods,
  ...waters,
  ...heights,
  ...deep,
  ...sands,
  ...frost,
  ...fire,
]

/** The alias keys a store makes of the seed's `alias{name}` components. */
export let keysOf = (rows: Bundle[]): Bundle[] =>
  rows.flatMap((r) => {
    let name = (r.alias as { name?: string } | undefined)?.name
    return name
      ? [{
        entity: { eid: `key:${name}` },
        key: { of: r.entity.eid, value: name },
      }]
      : []
  })

export let seedBeasts = () => {
  useBeasts(rows.filter((r) => r.beast_design))
  useDens(rows.filter((r) => r.den))
  useNames(keysOf(rows))
}
