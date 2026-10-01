/** Ledger, an invented rendering of printed labels and ruled records. It is
 * deliberately partial: the guide exposes both replacements and kit fallback. */
import { sheet as buttons } from './Button.ts'
import { sheet as tabs } from './Tabs.ts'
import { sheet as heads } from './Head.ts'
import { sheet as tiles } from './Tile.ts'
import type { Skin } from './theme.ts'

export let ledger: Skin = {
  Button: {
    css: new URL('./ledger/Button.css', import.meta.url),
    sheet: (c) => ({ ...buttons(c), Button: { fg: c.accent, bold: true } }),
  },
  Tabs: {
    css: new URL('./ledger/Tabs.css', import.meta.url),
    sheet: (c) => ({
      ...tabs(c),
      'Tabs_Tab-on': { fg: c.accent, bold: true, underline: true },
    }),
  },
  Head: {
    css: new URL('./ledger/Head.css', import.meta.url),
    sheet: (c) => ({
      ...heads(c),
      Head_Title: { fg: c.heading, bold: true, underline: true },
    }),
  },
  Tile: {
    css: new URL('./ledger/Tile.css', import.meta.url),
    sheet: (c) => ({ ...tiles(c), Tile_Title: { fg: c.text, bold: true } }),
  },
}
