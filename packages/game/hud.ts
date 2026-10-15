/** Display-only game HUD parts and their browser/terminal presentation.
 * Input, simulation state and application meaning stay with their callers. */
import type { Kit } from '@yaks/ui'
import * as grid from './hud/Grid.ts'
import * as stats from './hud/Stats.ts'
import * as stick from './hud/Stick.ts'

export { Grid } from './hud/Grid.ts'
export { Stats } from './hud/Stats.ts'
export { Stick, type StickProps } from './hud/Stick.ts'

/** The HUD kit carries the stylesheet, terminal entries and samples of each part. */
export let kit: Kit = {
  Grid: {
    ...grid,
    Component: grid.Grid,
    css: new URL('./hud/Grid.css', import.meta.url),
  },
  Stats: {
    ...stats,
    Component: stats.Stats,
    css: new URL('./hud/Stats.css', import.meta.url),
  },
  Stick: {
    ...stick,
    Component: stick.Stick,
    css: new URL('./hud/Stick.css', import.meta.url),
  },
}
