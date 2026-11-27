/** The party panel: `Party` lines (a health bar for each player and foe)
 * painted into the HUD's `#party` from a live watch, now and on every change.
 * The app says who stands in each list; the panel paints, and adds `#party`
 * to the HUD when the page has none, so a page that is rewritten keeps it. */
import type { Bundle } from '@yaks/graph'
import type { Theme } from '@yaks/ui'
import { themes } from '@yaks/ui/ui'
import { wearIn } from '@yaks/ui/wear'
import { h, render } from 'preact'
import { kit, Party, type PartyProps } from './hud.ts'

/** What the panel reads of a watch, such as the one `connectRoom` answers. */
export type Rows = {
  readonly value: Bundle[]
  readonly ready: boolean
  subscribe: (fn: () => void) => () => void
}

export type PanelOptions = { doc?: Document; theme?: Theme }

let worn = new WeakSet<Document>()

/** `#party`, or a panel added to the game's HUD when the page has none. */
let place = (doc: Document) => {
  let found = doc.querySelector<HTMLElement>('#party')
  if (found) return found
  let panel = doc.createElement('section')
  panel.id = 'party'
  panel.className = 'GameScreen_Control'
  panel.setAttribute('aria-label', 'Party and foes')
  let hud = doc.querySelector('.GameScreen_Hud') ?? doc.body
  hud.prepend(panel)
  return panel
}

/** Paint `lists(rows)` (the party, then its foes, each a `Party`) into
 * `#party` now and on every change of `rows`. The panel stays hidden until
 * the first rows arrive and while every list is empty. Wears the HUD kit in
 * `theme` (everforest when left out). Answers the function that stops it. */
export let partyPanel = (
  rows: Rows,
  lists: (rows: Bundle[]) => PartyProps[],
  { doc = document, theme = themes.everforest }: PanelOptions = {},
): () => void => {
  if (!worn.has(doc)) {
    worn.add(doc)
    void wearIn(doc, { kits: { hud: kit }, theme }).catch(reportError)
  }
  let panel = place(doc)
  let paint = () => {
    let shown = rows.ready ? lists(rows.value) : []
    panel.hidden = !shown.some((list) => list.members.length)
    render(
      shown.filter((list) => list.members.length).map((list) => h(Party, list)),
      panel,
    )
  }
  paint()
  return rows.subscribe(paint)
}
