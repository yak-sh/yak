// The written face of a doc title: inline markdown while reading, its source
// while editing. Most title faces are already links, so mdInline flattens any
// links and images rather than nesting interactive content.
import { mdInline } from '../md.ts'
import { Edit } from './Edit.tsx'

let rich = () =>
  typeof HTMLElement != 'undefined' && 'innerHTML' in HTMLElement.prototype

export let title = (text: string) =>
  rich()
    ? { dangerouslySetInnerHTML: { __html: mdInline(text) } }
    : { children: text }

export let TitleEdit = ({ eid }: { eid: string }) => (
  <Edit
    eid={eid}
    comp='doc'
    prop='title'
    html={rich() ? mdInline : undefined}
  />
)
