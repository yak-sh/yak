import { type Ent } from '../../types.ts'
import { ent } from '../../live.ts'
import { idOf } from './Id.tsx'

// A task as markdown with frontmatter — the file a dragged MD tab drops on
// the desktop, shown raw by the MD view (rendered markdown comes later).
export let mdText = (e: Ent) => {
  let refs = e.refs
    .map((r) => `${r.type}: ${idOf(ent(r.child))}`)
    .join('\n')
  return [
    '---',
    `id: ${idOf(e)}`,
    `title: ${e.task!.title}`,
    `status: ${e.task!.status}`,
    ...(refs ? [refs] : []),
    '---',
    '',
    e.task!.body,
    '',
  ].join('\n')
}

export let Md = ({ e }: { e: Ent }) => <pre class='Md'>{mdText(e)}</pre>
