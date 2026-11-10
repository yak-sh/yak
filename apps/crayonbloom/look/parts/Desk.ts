/** The studio's working surface: one column at the page's width, what it
 * holds a gap apart. `Desk.Head` is what the screen is (its title, and a
 * way back over it), `Desk.Pair` two cards side by side, one over the other
 * on a phone, and `Desk.Row` a line of presses. `Desk-read` is a narrower
 * column, for a page that is read. */
import { block, type Part } from '@yaks/ui/parts'

export let Desk: Part & Record<'Head' | 'Title' | 'Pair' | 'Row', Part> = block(
  'main',
  'Desk',
  { Head: 'header', Title: 'h1', Pair: 'div', Row: 'div' },
)
