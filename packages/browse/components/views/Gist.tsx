import { type Ent } from '../../types.ts'
import { ago } from '../Stamp.tsx'
import { title } from '../title.tsx'

/** The first line of a text that says something, its heading marks gone. */
/// firstLine('\n# Signal over noise\nJeff, verbatim') -> 'Signal over noise'
/// firstLine(undefined) -> ''
export let firstLine = (text?: string | null): string =>
  (text ?? '').split('\n').map((l) => l.replace(/^#+\s*/, '').trim())
    .find(Boolean) ?? ''

// What an entity is, in one line, beneath its name where a row says more than
// a name and less than a tile (an edge on its Full page): its kind, the first
// line of what it says, and when it was made. A kind says it its own way by
// registering its own `Gist` (a tool, the first line of what it does).
export let Gist = ({ e }: { e: Ent }) => {
  let said = firstLine(e.doc?.body)
  let at = e.created?.at
  let parts = [
    e.kind && <span key='kind'>{e.kind}</span>,
    said && <span key='said' {...title(said)} />,
    at && <time key='at' dateTime={at}>{ago(at)}</time>,
  ].filter(Boolean)
  return parts.length
    ? <span>{parts.flatMap((p, i) => i ? [' · ', p] : [p])}</span>
    : null
}
