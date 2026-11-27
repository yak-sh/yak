/** The party panel: a health bar for every player and every standing foe,
 * painted into `#party` from the room's rows on each change. `connectRoom`
 * starts it, so the page never paints it and a new page keeps it. Change how
 * the panel looks here, and how health is counted in `battle`. */
import type { Bundle } from '@yaks/graph'
import { kit, Party } from '@yaks/game/hud'
import { themes } from '@yaks/ui/ui'
import { wearIn } from '@yaks/ui/wear'
import { h, render } from 'preact'
import type { Seat } from './room-model.ts'
import { battle } from './room-rules.ts'

/** What the panel reads of the room's watch. */
export type RoomRows = {
  readonly value: Bundle[]
  readonly ready: boolean
  subscribe: (fn: () => void) => () => void
}

let worn = new WeakSet<Document>()

/** `#party`, or a panel added to the game's HUD when the page has none. */
let place = (doc: Document) => {
  let found = doc.querySelector<HTMLElement>('#party')
  if (found) return found
  let panel = doc.createElement('section')
  panel.id = 'party'
  panel.className = 'GameScreen_Control RoomPanel RoomParty'
  panel.setAttribute('aria-label', 'Party and foes')
  let hud = doc.querySelector('.GameScreen_Hud') ?? doc.body
  hud.prepend(panel)
  return panel
}

/** Paint the room's party and standing foes into `#party` now and on every
 * change; the panel stays hidden until the room's first rows arrive. Answers
 * the function that stops it. */
export let partyPanel = (
  rows: RoomRows,
  { room, seat }: Seat,
  doc: Document = document,
): () => void => {
  if (!worn.has(doc)) {
    worn.add(doc)
    void wearIn(doc, { kits: { hud: kit }, theme: themes.everforest })
      .catch(reportError)
  }
  let panel = place(doc)
  let paint = () => {
    let { turn, party, foes } = battle(rows.value, room)
    let standing = foes.filter((f) => f.hp > 0)
    panel.hidden = !rows.ready || !party.length
    render(
      [
        h(Party, {
          members: party.map((p) => ({
            ...p,
            turn: p.eid === turn?.seat,
            own: p.eid === seat,
          })),
        }),
        standing.length > 0 && h(Party, { label: 'Foes', members: standing }),
      ],
      panel,
    )
  }
  paint()
  return rows.subscribe(paint)
}
