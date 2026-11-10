/** A summary control and the panel it reveals. @module */
import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'
import { Button } from './Button.ts'

/** A summary control and the panel it reveals. */
export let Popover:
  & Part
  & Record<'Trigger' | 'Count' | 'Line' | 'Time' | 'Body', Part> = block(
    'aside',
    'Popover',
    { Trigger: Button, Count: 'span', Line: 'p', Time: 'time', Body: 'div' },
  )
/** What this part presents. */
export let description = 'A summary control and the panel it reveals.'
/** The same parts in a terminal. */
export let sheet = (c: Colors): Sheet => ({
  Popover: { col: true },
  Popover_Trigger: { row: true },
  Popover_Count: { fg: c.muted },
  Popover_Body: { col: true },
  Popover_Time: { fg: c.muted },
})
/** A complete example. */
export let specimens = (): Specimen[] => [
  [
    'Popover, variants',
    h(
      Popover,
      { mod: 'responsive', 'data-open': '' },
      h(Popover.Trigger, {}, 'Activity', h(Popover.Count, {}, '+2')),
      h(
        Popover.Body,
        {},
        h(Popover.Line, {}, 'Working · ', h(Popover.Time, {}, '12s')),
      ),
    ),
  ],
  [
    'Popover',
    h(
      Popover,
      { 'data-open': '' },
      h(Popover.Trigger, { 'aria-expanded': 'true' }, 'Activity'),
      h(Popover.Body, {}, h(Popover.Line, {}, 'Nothing running')),
    ),
  ],
]
