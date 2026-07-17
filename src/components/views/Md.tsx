import { type Ent } from '../../types.ts'
import { ent } from '../../live.ts'
import { el } from '../ui.tsx'
import { idOf } from '../../types.ts'

// A doc as markdown with frontmatter — the file a dragged Markdown tab drops on
// the desktop, shown raw by the Markdown view. Any entity with a doc qualifies;
// workflow lines (status) appear only where the entity carries them.
export let mdText = (e: Ent) => {
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
    e.doc?.body ?? '',
    '',
  ].join('\n')
}

let Pre = el('pre', 'Md')

export let Md = ({ e }: { e: Ent }) => <Pre>{mdText(e)}</Pre>
