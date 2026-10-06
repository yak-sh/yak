// The written face of a doc title: inline markdown while reading, its source
// while editing. Most title faces are already links, so mdInline flattens any
// links and images rather than nesting interactive content.
import { Edit } from '@yaks/ux'
import { ent } from '../live.ts'
import { markdown } from './Markdown.tsx'
import { bundle } from './registry.ts'
import { type Ent, idOf } from '../types.ts'

let rich = () =>
  typeof HTMLElement != 'undefined' && 'innerHTML' in HTMLElement.prototype

export let title = (text: string) =>
  rich() ? markdown(text, undefined, true) : { children: text }

/** A document's `Title` view in Browse: its title's inline markdown, read. */
export let TitleText = ({ e }: { e: Ent }) => (
  <span {...title(e.doc?.title || idOf(e))} />
)

export let TitleEdit = ({ eid }: { eid: string }) => (
  <Edit.Text
    e={bundle(ent(eid))}
    comp='doc'
    prop='title'
    inline={rich()}
  />
)
