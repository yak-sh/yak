import { type Ent } from '../../types.ts'
import { el } from '../ui.tsx'

let Frame = el('iframe', 'Web')

// An external page, framed in the card. Sites that forbid framing
// (X-Frame-Options) come up blank — that's them, not us.
export let Web = ({ e }: { e: Ent }) => <Frame src={e.web!.url} />
