// Tests read the kit's terminal paint without a tty.
import { lay, type TElement } from '@yaks/tui'
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
