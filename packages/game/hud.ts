/** Display-only game HUD parts and their browser/terminal presentation.
 * Input, simulation state and application meaning stay with their callers. */
import type { Kit } from '@yaks/ui'
import { beside } from '@yaks/ui/parts'
import * as grid from './hud/Grid.ts'
import * as party from './hud/Party.ts'
import * as stats from './hud/Stats.ts'
import * as stick from './hud/Stick.ts'

export { Grid } from './hud/Grid.ts'
export { type Member, Party, type PartyProps } from './hud/Party.ts'
export { Stats } from './hud/Stats.ts'
export { Stick, type StickProps } from './hud/Stick.ts'

let here = beside(import.meta.url)

/** The HUD kit carries the stylesheet, terminal entries and samples of each part. */
export let kit: Kit = {
  Grid: {
    ...grid,
    Component: grid.Grid,
    css: here('./hud/Grid.css'),
  },
  Party: {
    ...party,
    Component: party.Party,
    css: here('./hud/Party.css'),
  },
  Stats: {
    ...stats,
    Component: stats.Stats,
    css: here('./hud/Stats.css'),
  },
  Stick: {
    ...stick,
    Component: stick.Stick,
    css: here('./hud/Stick.css'),
  },
}
