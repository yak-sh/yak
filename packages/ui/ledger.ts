/** Ledger, an invented rendering of printed labels and ruled records. It is
 * deliberately partial: the guide exposes both replacements and kit fallback. */
import { sheet as buttons } from './Button.ts'
import { sheet as tabs } from './Tabs.ts'
import { sheet as heads } from './Head.ts'
import { sheet as tiles } from './Tile.ts'
import { beside, type Skin } from './theme.ts'

let at = beside(import.meta.url)

export let ledger: Skin = {
  Button: {
    over: at('./ledger/Button.css'),
    sheet: (c) => ({ ...buttons(c), Button: { fg: c.accent, bold: true } }),
  },
  Tabs: {
    over: at('./ledger/Tabs.css'),
    sheet: (c) => ({
      ...tabs(c),
      'Tabs_Tab-on': { fg: c.accent, bold: true, underline: true },
    }),
  },
  Head: {
    css: at('./ledger/Head.css'),
    sheet: (c) => ({
      ...heads(c),
      Head_Title: { fg: c.heading, bold: true, underline: true },
    }),
  },
  Tile: {
    css: at('./ledger/Tile.css'),
    sheet: (c) => ({ ...tiles(c), Tile_Title: { fg: c.text, bold: true } }),
  },
}
