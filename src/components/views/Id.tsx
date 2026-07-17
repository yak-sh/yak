import { type Ent, idOf } from '../../types.ts'
import { el } from '../ui.tsx'
import { linkProps } from '../nav.tsx'

let Chip = el('a', 'Id')

// The universal id chip: T-7, P-2, … — and the universal LINK, wearing
// the whole internal-link contract (nav.tsx linkProps): plain click
// follows in place, cmd/middle-click and the browser's OWN context menu
// do the new-tab forms, dragging it onto the canvas makes a card. The
// custom "open here" menu belongs to the CARD, not to links.
export let Id = ({ e }: { e: Ent }) => <Chip {...linkProps(e)}>{idOf(e)}</Chip>
