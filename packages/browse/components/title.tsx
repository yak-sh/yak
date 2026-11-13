/** @jsxImportSource preact */
// The written face of a doc title: inline markdown while reading, its source
// while editing. Most title faces are already links, so the title's own links,
// images and ids flatten to their words rather than nesting interactive
// content.
import { Edit } from '@yaks/ux'
import { ent } from '../live.ts'
import { markup } from './Markdown.tsx'
import { bundle } from './registry.ts'
import { type Ent, idOf } from '../types.ts'

export let title = (text: string) => ({ children: markup(text, null, true) })

/** A document's `Title` view in Browse: its title's inline markdown, read. */
export let TitleText = ({ e }: { e: Ent }) => (
  <span {...title(e.doc?.title || idOf(e))} />
)

export let TitleEdit = ({ eid }: { eid: string }) => (
  <Edit.Text e={bundle(ent(eid))} comp='doc' prop='title' inline />
)
