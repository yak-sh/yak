/** A tray on the desk: things that go together under the heading that says
 * what they are for (`Tray.Title`), with a `Tray.Note` for the line that
 * explains them. `Tray-ruled` is one inside a card, ruled off from what is
 * above it in pencil, its heading a step smaller. */
import { block, type Part } from '@yaks/ui/parts'

export let Tray: Part & Record<'Title' | 'Note', Part> = block(
  'section',
  'Tray',
  { Title: 'h3', Note: 'p' },
)
