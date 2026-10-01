// Tests install the same figures a new app store receives from its seed.
import { useFigures } from './figure.ts'
import deep from './seed/figures/deep.json' with { type: 'json' }
import fire from './seed/figures/fire.json' with { type: 'json' }
import frost from './seed/figures/frost.json' with { type: 'json' }
import heights from './seed/figures/heights.json' with { type: 'json' }
import meadow from './seed/figures/meadow.json' with { type: 'json' }
import sands from './seed/figures/sands.json' with { type: 'json' }
import waters from './seed/figures/waters.json' with { type: 'json' }
import woods from './seed/figures/woods.json' with { type: 'json' }

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

export let seedFigures = () => useFigures(rows)
