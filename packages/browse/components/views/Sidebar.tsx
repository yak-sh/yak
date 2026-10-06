// The entry inside the sidebar's link, not a card or a second link. Titles
// still come from the shipped registry, so non-doc kinds have a face too.
import { type Ent, idOf } from '../../types.ts'
import { renderView } from '../registry.ts'

export let SidebarTile = ({ e }: { e: Ent }) => (
  <span class='SidebarTile'>
    <span class='SidebarTile_Title'>
      {renderView(e, 'Title', { in: 'Tile' })}
    </span>
    <span class='SidebarTile_Id'>{idOf(e)}</span>
  </span>
)
