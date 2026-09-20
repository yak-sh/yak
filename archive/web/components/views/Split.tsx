// The two-pane inbox: a list on the LEFT, the opened entity on the RIGHT
// (T-17321). A view of ANY entity with a list face — a project/board shows
// its Board, a canvas its List — so "the left can be a board, a List, a
// project, anything" falls out of the registry, not new structure. Clicking
// a left row fills the right pane instead of navigating: the rows are already
// real /id anchors, so the left pane owns ONE capture-phase click handler
// that reads the anchor's href and opens it here — no onOpen threading
// through Board, no global selection, and the URL still names one root.
// Selection is view-local on purpose (transient, not shareable); a ?sel=
// URL param is the noted follow-up when sharing is wanted.
import { useState } from 'preact/hooks'
import { type Ent } from '../../types.ts'
import { block } from '../ui.tsx'
import { eidOf } from '../nav.tsx'
import { Entity } from '../Entity.tsx'

let Frame = block('div', 'Split', {
  Left: 'div',
  Right: 'div',
  Empty: 'div',
})

export let Split = ({ e }: { e: Ent }) => {
  let [sel, setSel] = useState<string | null>(null)
  // The left face is the entity's own list: a board query renders as a
  // Board (its columns snap on a narrow host, for free), everything else
  // as a List.
  let left = e.board ? 'Board' : 'List'
  // A plain click on an entity link opens it on the right rather than
  // navigating the whole root. Capture-phase so it wins before the anchor's
  // own follow() and the document's delegated ref-opener; modified and
  // middle clicks fall through untouched, keeping native new-tab.
  let open = (ev: MouseEvent) => {
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button != 0) return
    let a = (ev.target as Element | null)?.closest?.('a[href]')
    let id = a?.getAttribute('href')?.match(/^\/([^/?#]+)/)?.[1]
    let eid = id && eidOf(id)
    if (!eid) return
    ev.preventDefault()
    ev.stopPropagation()
    setSel(eid)
  }
  return (
    <Frame>
      <Frame.Left onClickCapture={open}>
        <Entity eid={e.eid} view={left} />
      </Frame.Left>
      <Frame.Right>
        {sel ? <Entity eid={sel} view='Full' /> : (
          <Frame.Empty>
            Pick something on the left to open it here.
          </Frame.Empty>
        )}
      </Frame.Right>
    </Frame>
  )
}
