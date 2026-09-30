// What the harness wears in a terminal: @yaks/ui's components and @yaks/tui's
// widgets, the portable views' classes, and its own (its text tones, its
// composer's border, its panels' selections), all in Everforest.

import * as generic from '@yaks/render/views'
import type { Sheet } from '@yaks/tui'
import { type Colors, everforest, sheet } from '@yaks/ui'

let own = (c: Colors): Sheet => ({
  Title: { bold: true },
  Dim: { fg: c.dim, dim: true },
  Key: { fg: c.active },
  Accent: { fg: c.info },
  Good: { fg: c.positive },
  Task: { fg: c.hues[4] }, // a mode, told apart from Good
  Warn: { fg: c.caution },
  Bad: { fg: c.negative },
  Rule: { fg: c.dim },
  Composer_Border: { fg: c.dim, dim: true },
  Selection_Active: { bg: c.card, fg: c.accent },
  Session_Selected: { bg: c.card },
})

export let dress: Sheet = {
  ...sheet(everforest),
  ...generic.sheet(everforest.colors),
  ...own(everforest.colors),
}
