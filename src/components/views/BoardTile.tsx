// A board's Tile and Meta faces: one ordinary linked tile whose second row
// carries the same status counts as the board's columns.
import { type ComponentChildren } from 'preact'
import { type Ent } from '../../types.ts'
import { boardTasks, statuses } from '../../live.ts'
import { Entity } from '../Entity.tsx'
import { menuAt } from '../nav.tsx'
import { useBoardSub } from '../subscriptions.ts'
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
  useBoardSub(e)
  let tasks: Ent[]
  try {
    tasks = boardTasks(e)
  } catch {
    return <Meta e={e} id={id}>{children}</Meta>
  }
  let stats = (
    <>
      {statuses.map((status) => (
        <Stat key={status}>
          <Dot status={status} />
          {tasks.filter((task) => task.task?.status == status).length}
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
