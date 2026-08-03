import { type Ent, idOf, kindOf } from '../../types.ts'
import { cache, deps, ent, pending } from '../../live.ts'
import { el } from '../ui.tsx'
import { materialize } from '../../persona.ts'
import type { Row } from '../../client.ts'

// A doc as markdown with frontmatter — the file a dragged Markdown tab drops on
// the desktop, shown raw by the Markdown view. Any entity with a doc qualifies;
// workflow lines (status) appear only where the entity carries them.
// A PERSONA's file is its materialization — the same bytes sync writes to
// .tasks/ (header, core text, preloaded bodies, index) — so what you see
// raw is exactly what a spawned session reads.
let asRows = (): Row[] =>
  Object.entries(cache.value).map(([eid, c]) => ({
    eid,
    num: Number(c.entity?.num ?? 0),
    kind: kindOf(c),
    comps: c as unknown as Row['comps'],
  }))

export let mdText = (e: Ent) => {
  if (e.persona) {
    let all = asRows()
    let p = all.find((r) => r.eid == e.eid)
    if (p) return materialize(all, deps.value, p, Date.now())
  }
  let refs = e.refs
    .map((r) => `${r.type}: ${idOf(ent(r.child))}`)
    .join('\n')
  return [
    '---',
    `id: ${idOf(e)}`,
    `title: ${e.doc?.title ?? ''}`,
    ...(e.task ? [`status: ${e.task.status}`] : []),
    ...(refs ? [refs] : []),
    '---',
    '',
    // The raw file is also what a drag drops on the desktop, so a body this
    // client hasn't been shipped says so rather than dropping an empty one.
    pending(e) ? '…' : e.doc?.body ?? '',
    '',
  ].join('\n')
}

let Pre = el('pre', 'Md')

export let Md = ({ e }: { e: Ent }) => <Pre>{mdText(e)}</Pre>
