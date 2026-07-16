import { type Ent } from '../../db.ts'

let prefix: Record<string, string> = { task: 'T', project: 'P' }

// The universal id chip: T-7, P-2, … — one element for every id on screen,
// so ids grow drag/click behavior in exactly one place.
export let Id = ({ e }: { e: Ent }) => (
  <span class='Id'>{prefix[e.kind] ?? e.kind[0].toUpperCase()}-{e.num}</span>
)
