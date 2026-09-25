// Titles derived from component facets, shared by every display door.
import { idOf } from './types.ts'
import { local, relative } from './time.ts'

type Face = {
  wake?: { at?: unknown }
  deliver?: { to?: unknown }
}
type Ref = { eid: string; kind: string; num?: number | null }

type WakeFace = Ref & Face & {
  wake?: { at?: unknown; target?: unknown; note?: unknown }
  comps?: {
    wake?: { at?: unknown; target?: unknown; note?: unknown }
  }
}

export let wakeTitle = (
  e: Face,
  ref: (eid: string) => Ref | undefined,
  now = Date.now(),
) => {
  let to = String(e.deliver?.to ?? '')
  let who = to ? idOf(ref(to) ?? { eid: to, kind: 'entity' }) : 'someone'
  return `wake ${who} · ${relative(String(e.wake?.at ?? ''), now)}`
}

export let wakeList = (
  wakes: WakeFace[],
  to: Ref,
  ref: (eid: string) => Ref | undefined,
) => {
  let lines = wakes.toSorted((a, b) =>
    String((a.comps?.wake ?? a.wake)?.at ?? '').localeCompare(
      String((b.comps?.wake ?? b.wake)?.at ?? ''),
    )
  ).map((e) => {
    let wake = e.comps?.wake ?? e.wake
    let target = String(wake?.target ?? '')
    let note = String(wake?.note ?? '')
    return `- ${idOf(e)} ${local(String(wake?.at ?? ''))}` +
      (target
        ? ` → ${idOf(ref(target) ?? { eid: target, kind: 'entity' })}`
        : '') +
      (note ? ` — ${note}` : '')
  })
  return `pending wakes for ${idOf(to)} (${lines.length}):` +
    (lines.length ? `\n${lines.join('\n')}` : ' none')
}
