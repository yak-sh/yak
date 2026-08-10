// Titles derived from component facets, shared by every display door.
import { idOf } from './types.ts'
import { relative } from './time.ts'

type Face = {
  wake?: { at?: unknown }
  deliver?: { to?: unknown }
}
type Ref = { eid: string; kind: string; num?: number | null }

export let wakeTitle = (
  e: Face,
  ref: (eid: string) => Ref | undefined,
  now = Date.now(),
) => {
  let to = String(e.deliver?.to ?? '')
  let who = to ? idOf(ref(to) ?? { eid: to, kind: 'entity' }) : 'someone'
  return `wake ${who} · ${relative(String(e.wake?.at ?? ''), now)}`
}
