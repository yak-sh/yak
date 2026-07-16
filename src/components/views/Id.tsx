import { type Ent } from '../../types.ts'

let prefix: Record<string, string> = { task: 'T', project: 'P' }

// The universal id, as text — also the filename stem for dragged-out files.
export let idOf = (e: Ent) =>
  `${prefix[e.kind] ?? e.kind[0].toUpperCase()}-${e.num}`

// The universal id chip: T-7, P-2, … — one element for every id on screen,
// so ids grow drag/click behavior in exactly one place.
export let Id = ({ e }: { e: Ent }) => <span class='Id'>{idOf(e)}</span>
