import { type Ent } from '../../types.ts'
import { clickProps, menuAt } from '../nav.tsx'
import { block, el, Stamp } from '../ui.tsx'
import { Id } from './Inline.tsx'

// A memory in a list: index line, confirmation age, id — with `feedback`
// ahead of it when the memory records someone's correction, the one thing
// the retired type enum said that the line did not already carry. The
// existing ListTile shell keeps it at home beside every other feed row;
// only the content is specific to memory.
let Line = block('div', 'ListTile', { Title: 'span' })
let Type = el('span', 'MemoryType')

export let MemoryTile = ({ e }: { e: Ent }) => (
  <Line {...clickProps(e)} onContextMenu={menuAt(e)}>
    {e.feedback ? <Type>feedback</Type> : null}
    <Line.Title>{e.doc!.title}</Line.Title>
    <Stamp at={e.memory!.last_confirmed_at} label='confirmed' />
    <Id e={e} />
  </Line>
)
