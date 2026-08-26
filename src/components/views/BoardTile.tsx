// A board's Tile and Meta faces: one ordinary linked tile whose second row
// carries the same status counts as the board's columns.
//
// The counts come from an AGGREGATE subscription, never the board's members
// (T-22509): a tile renders four numbers, so it asks the server for four
// numbers. Streaming membership for them put ~4.4k task rows on the wire for
// every canvas that showed the Everything tile; only a FULLSCREEN board
// (Board.tsx, List.tsx) opens the member sub.
import { type ComponentChildren } from 'preact'
import { type Ent } from '../../types.ts'
import { boardTally, statuses } from '../../live.ts'
import { Entity } from '../Entity.tsx'
import { menuAt } from '../nav.tsx'
import { useBoardTally } from '../subscriptions.ts'
import {
  slot,
  TileFrame,
  tileLink,
  type TileProps,
  tileTitle,
} from '../Tile.tsx'
import { el } from '../ui.tsx'
import { Dot } from '../Dot.tsx'
import { Meta } from './Show.tsx'

let Stat = el('span', 'BoardStat')

export let BoardMeta = (
  { e, id, children }: { e: Ent; id?: boolean; children?: ComponentChildren },
) => {
  useBoardTally(e)
  // No tally yet — the sub hasn't answered, or the query doesn't parse — paints
  // no stats at all. Four zeros would be a claim, and a wrong one.
  let counts = boardTally(e)
  let stats = counts && (
    <>
      {statuses.map((status) => (
        <Stat key={status}>
          <Dot status={status} />
          {counts[status] ?? 0}
        </Stat>
      ))}
    </>
  )
  return <Meta e={e} id={id} before={stats}>{children}</Meta>
}

export let BoardTile = ({ e, slots, onOpen }: TileProps) => (
  <TileFrame
    mod={['board', 'dense']}
    {...tileLink(e, onOpen)}
    onContextMenu={menuAt(e)}
  >
    <TileFrame.Head>
      {slot(slots, 'before')}
      <TileFrame.Title {...tileTitle(slots, e.doc?.title ?? '')} />
    </TileFrame.Head>
    <Entity eid={e.eid} view='Meta' id>
      {slot(slots, 'after')}
    </Entity>
    {slot(slots, 'body')}
  </TileFrame>
)
