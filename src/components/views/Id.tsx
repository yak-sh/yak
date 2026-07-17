import { type Ent, idOf } from '../../types.ts'
import { el } from '../ui.tsx'
import { menu, navigate } from '../nav.tsx'

let Chip = el('a', 'Id')

// Touch is tap-to-go; a fine pointer saves plain click for selection and
// keeps navigation deliberate (modifiers, or the context menu).
let coarse = () =>
  (globalThis as { matchMedia?: (q: string) => { matches: boolean } })
    .matchMedia?.('(pointer: coarse)').matches ?? false

// The universal id chip: T-7, P-2, … — and the universal LINK. A real
// anchor, so cmd/middle-click and open-in-new-tab are the browser's own;
// plain click navigates on touch; right-click offers the deliberate
// "open here" (root change) beside "open in new tab".
export let Id = ({ e }: { e: Ent }) => {
  let href = `/${idOf(e)}`
  return (
    <Chip
      href={href}
      draggable={false}
      onClick={(ev: MouseEvent) => {
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button != 0) return
        ev.preventDefault()
        ev.stopPropagation()
        if (coarse()) navigate(href)
      }}
      onContextMenu={(ev: MouseEvent) => {
        ev.preventDefault()
        ev.stopPropagation()
        menu.value = { x: ev.clientX, y: ev.clientY, href }
      }}
    >
      {idOf(e)}
    </Chip>
  )
}
