import { type Ent } from '../../types.ts'
import { crewed, gated } from '../../live.ts'
import { Dot } from '../Dot.tsx'
import { Entity } from '../Entity.tsx'
import { clickProps, menuAt } from '../nav.tsx'
import { block } from '../ui.tsx'
import { title } from '../title.tsx'

let Frame = block('div', 'TaskTile', { Title: 'span' })
let { Title } = Frame

// A task as a small board card, Trello-shaped: wrapping title beside its
// dot, then the shared Meta registry view at tile density. The whole tile is
// the LINK — clickProps on the el: click peeks, double click navigates — and
// right-click serves the app menu (menuAt), so the verbs are one click from
// any board. Drag out to the canvas for the full Task card (the board Item
// owns the drag).
export let TaskTile = ({ e }: { e: Ent }) => (
  <Frame mod='dense' {...clickProps(e)} onContextMenu={menuAt(e)}>
    <Dot status={e.task!.status} gated={gated(e)} live={crewed(e)} />
    <Title {...title(e.doc?.title ?? '')} />
    <Entity eid={e.eid} view='Meta' id />
  </Frame>
)
