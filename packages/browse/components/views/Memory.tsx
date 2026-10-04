import { menuAt } from '../nav.tsx'
import { slot, tileLink, type TileProps, tileTitle } from '../Tile.tsx'
import { block, el } from '@yaks/ui'
import { Stamp } from '../Stamp.tsx'
import { Id } from './Inline.tsx'
import { words } from '@yaks/memory'
import type { Ent } from '../../types.ts'

// A memory in a list: index line, confirmation age, id — with `feedback`
// ahead of it when the memory records someone's correction, the one thing
// the retired type enum said that the line did not already carry. The
// existing tile shell keeps it at home beside every other feed row;
// only the content is specific to memory. A memory marks words wherever they
// are (a doc, a comment, a transcript entry), so the index line is the title
// somebody gave it, else the first line of those words.
let Line = block('div', 'ListTile', { Title: 'span' })
let Type = el('span', 'MemoryType')

let index = (e: Ent) => e.doc?.title || words(e).trim().split('\n')[0]

export let MemoryTile = ({ e, slots, onOpen }: TileProps) => (
  <Line {...tileLink(e, onOpen)} onContextMenu={menuAt(e)}>
    {slot(slots, 'before')}
    {e.feedback ? <Type>feedback</Type> : null}
    <Line.Title {...tileTitle(slots, index(e))} />
    <Stamp at={e.memory!.last_confirmed_at} label='confirmed' />
    <Id e={e} />
    {slot(slots, 'after')}
    {slot(slots, 'body')}
  </Line>
)
