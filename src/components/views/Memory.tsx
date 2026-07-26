import { type Ent } from '../../types.ts'
import { clickProps, menuAt } from '../nav.tsx'
import { block, el, Stamp } from '../ui.tsx'
import { Id } from './Inline.tsx'

// A memory in a list: type, index line, confirmation age, id. The
// existing ListTile shell keeps it at home beside every other feed row;
// only the content is specific to memory.
let Line = block('div', 'ListTile', { Title: 'span' })
let Type = el('span', 'MemoryType')

export let MemoryTile = ({ e }: { e: Ent }) => (
  <Line {...clickProps(e)} onContextMenu={menuAt(e)}>
    <Type>{e.memory!.type}</Type>
    <Line.Title>{e.doc!.title}</Line.Title>
    <Stamp at={e.memory!.last_confirmed_at} label='confirmed' />
    <Id e={e} />
  </Line>
)
