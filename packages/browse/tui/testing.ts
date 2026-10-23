// Tests read the kit's terminal paint without a tty.
import { lay, place, screenful, type TElement } from '@yaks/tui'
import { everforest, kits, sheet as dress } from '@yaks/ui'
let sheet = {
  ...dress({ kits, theme: everforest }),
  Entry_Speaker: { block: true },
  Md_B: { bold: true },
}
export let pane = (root: TElement) => ({
  lines: lay(root, {}, 120, null, { sheet, metrics: {}, spaced: true }),
  status: [],
})

/** The screen a 120 by 30 terminal paints, as the run loop paints it: its
 * elements then measure themselves by what it painted. */
export let paint = (root: TElement) => {
  let { lines, hidden } = screenful(root, 120, 30, sheet)
  place(lines, hidden)
  return lines
}
