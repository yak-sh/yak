import { type Ent } from '../../types.ts'
import { gated } from '../../live.ts'
import { Dot } from '../Dot.tsx'
import { Prio } from '../Prio.tsx'
import { block } from '../ui.tsx'
import { idOf } from '../../types.ts'

let Frame = block('div', 'TaskRow', {
  Title: 'span',
  Claim: 'span',
  Id: 'span',
})
let { Title, Claim, Id } = Frame

// A task as one summary line — what a board full of hundreds renders.
// Plain spans only (no editors, no markdown, no comments): a board is a
// map, not 300 open documents. Drag the row out to the canvas for the
// full Task card; the drag wiring lives on Board_Item.
export let TaskRow = ({ e }: { e: Ent }) => (
  <Frame>
    <Dot status={e.task!.status} gated={gated(e)} />
    <Title>{e.doc?.title}</Title>
    {e.claim && <Claim>⚑</Claim>}
    <Prio p={e.task!.priority} />
    <Id>{idOf(e)}</Id>
  </Frame>
)
