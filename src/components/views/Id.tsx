import { type Ent, idOf } from '../../types.ts'
import { el } from '../ui.tsx'

let Chip = el('span', 'Id')

// The universal id chip: T-7, P-2, … — one element for every id on screen,
// so ids grow drag/click behavior in exactly one place. The text form
// (idOf) is vocabulary — types.ts owns it.
export let Id = ({ e }: { e: Ent }) => <Chip>{idOf(e)}</Chip>
