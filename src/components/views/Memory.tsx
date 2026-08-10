import { menuAt } from '../nav.tsx'
import { slot, tileLink, type TileProps } from '../Tile.tsx'
import { block, el, Stamp } from '../ui.tsx'
import { Id } from './Inline.tsx'
import { title } from '../title.tsx'

// A memory in a list: index line, confirmation age, id — with `feedback`
// ahead of it when the memory records someone's correction, the one thing
// the retired type enum said that the line did not already carry. The
// existing tile shell keeps it at home beside every other feed row;
// only the content is specific to memory.
let Line = block('div', 'ListTile', { Title: 'span' })
let Type = el('span', 'MemoryType')

export let MemoryTile = ({ e, slots, onOpen }: TileProps) => (
  <Line {...tileLink(e, onOpen)} onContextMenu={menuAt(e)}>
    {slot(slots, 'before')}
    {e.feedback ? <Type>feedback</Type> : null}
    <Line.Title {...title(e.doc!.title)} />
    <Stamp at={e.memory!.last_confirmed_at} label='confirmed' />
    <Id e={e} />
    {slot(slots, 'after')}
  </Line>
)
