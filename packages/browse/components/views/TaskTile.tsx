import { crewed, gated } from '../../live.ts'
import { statusOf } from '../../types.ts'
import { Dot } from '../Dot.tsx'
import { Entity } from '../Entity.tsx'
import { menuAt } from '../nav.tsx'
import {
  slot,
  TileFrame,
  tileLink,
  type TileProps,
  tileTitle,
} from '../Tile.tsx'

let { Title } = TileFrame

// A task as a small board card, Trello-shaped: wrapping title beside its
// dot, then the shared Meta registry view at tile density. The whole tile is
// the LINK — clickProps on the el: click peeks, double click navigates — and
// right-click serves the app menu (menuAt), so the verbs are one click from
// any board. Drag out to the canvas for the full Task card (the board Item
// owns the drag).
export let TaskTile = ({ e, slots, onOpen }: TileProps) => (
  <TileFrame
    mod={['task', 'dense']}
    {...tileLink(e, onOpen)}
    onContextMenu={menuAt(e)}
  >
    {slot(slots, 'before')}
    <Dot status={statusOf(e)} gated={gated(e)} live={crewed(e)} />
    <Title {...tileTitle(slots, e.doc?.title ?? '')} />
    <Entity eid={e.eid} view='Meta' id>
      {slot(slots, 'after')}
    </Entity>
    {slot(slots, 'body')}
  </TileFrame>
)
