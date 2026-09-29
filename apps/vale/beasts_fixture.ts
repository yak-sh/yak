// Tests install the same rows a new app store receives from its seed.
import { useBeasts } from './beasts.ts'
import deep from './seed/beasts/deep.json' with { type: 'json' }
import fire from './seed/beasts/fire.json' with { type: 'json' }
import frost from './seed/beasts/frost.json' with { type: 'json' }
import heights from './seed/beasts/heights.json' with { type: 'json' }
import meadow from './seed/beasts/meadow.json' with { type: 'json' }
import sands from './seed/beasts/sands.json' with { type: 'json' }
import waters from './seed/beasts/waters.json' with { type: 'json' }
import woods from './seed/beasts/woods.json' with { type: 'json' }

export let rows = [
  ...meadow,
  ...woods,
  ...waters,
  ...heights,
  ...deep,
  ...sands,
  ...frost,
  ...fire,
]

export let seedBeasts = () => useBeasts(rows)
