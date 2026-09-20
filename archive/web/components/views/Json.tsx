import { type Ent } from '../../types.ts'
import { highlight } from '../../highlight.ts'
import { el } from '../ui.tsx'

let Pre = el('pre', 'Json')

// Any entity as raw JSON — the debugging floor; matches everything.
export let Json = ({ e }: { e: Ent }) => {
  let lit = highlight(JSON.stringify(e, null, 2), 'json')
  return (
    <Pre>
      <code
        class='hljs language-json'
        dangerouslySetInnerHTML={{ __html: lit.html }}
      />
    </Pre>
  )
}
