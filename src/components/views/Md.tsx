import { type Ent, idOf } from '../../types.ts'
import { ent, pending } from '../../live.ts'
import { el } from '../ui.tsx'
import { highlight } from '../../highlight.ts'
import { type Materialized, useResultComponent } from '../useQuery.ts'

// A doc as markdown with frontmatter — the file a dragged Markdown tab drops on
// the desktop, shown raw by the Markdown view. Any entity with a doc qualifies;
// workflow lines (status) appear only where the entity carries them.
// A PERSONA's file is its materialization — the same bytes sync writes to
// .tasks/ (header, core text, preloaded bodies, index) — so what you see
// raw is exactly what a spawned session reads. The query-result materialized
// component computes those bytes from the spawn path's bounded personaGraph closure;
// rendering from the partial browser cache would miss tier rows and edges.
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
    // The raw file is also what a drag drops on the desktop, so a body this
    // client hasn't been shipped says so rather than dropping an empty one.
    pending(e) ? '…' : e.doc?.body ?? '',
    '',
  ].join('\n')
}

let Pre = el('pre', 'Md')

export let Md = ({ e }: { e: Ent }) => {
  let materialized = useResultComponent(
    e.eid,
    'materialized',
    !!e.persona,
  ) as Materialized | undefined
  let text = e.persona ? (materialized?.text ?? '…\n') : mdText(e)
  let lit = highlight(text, 'markdown')
  return (
    <Pre>
      <code
        class='hljs language-markdown'
        dangerouslySetInnerHTML={{ __html: lit.html }}
      />
    </Pre>
  )
}
