import { useEffect, useState } from 'preact/hooks'
import { type Ent, idOf } from '../../types.ts'
import { base, ent, pending } from '../../live.ts'
import { el } from '../ui.tsx'
import { highlight } from '../../highlight.ts'

// A doc as markdown with frontmatter — the file a dragged Markdown tab drops on
// the desktop, shown raw by the Markdown view. Any entity with a doc qualifies;
// workflow lines (status) appear only where the entity carries them.
// A PERSONA's file is its materialization — the same bytes sync writes to
// .tasks/ (header, core text, preloaded bodies, index) — so what you see
// raw is exactly what a spawned session reads. Those bytes are fetched from
// the server (/persona), which materializes over the WHOLE graph: rendering
// them from this client's cache would miss any tier memory or edge it hasn't
// loaded and quietly show a corrupt prompt (T-18104).
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

// A persona's materialization, fetched from the server so it never depends on
// the client cache. Null while the round trip is in flight (rendered as `…`);
// a dead server or a persona that vanished simply leaves the last text.
let usePersonaMd = (e: Ent): string | null => {
  let [text, setText] = useState<string | null>(null)
  useEffect(() => {
    if (!e.persona) return
    setText(null)
    let abort = new AbortController()
    fetch(`${base()}/persona?id=${e.eid}`, { signal: abort.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setText(d.text))
      .catch(() => {})
    return () => abort.abort()
  }, [e.eid, e.persona])
  return text
}

let Pre = el('pre', 'Md')

export let Md = ({ e }: { e: Ent }) => {
  let persona = usePersonaMd(e)
  let text = e.persona ? (persona ?? '…\n') : mdText(e)
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
