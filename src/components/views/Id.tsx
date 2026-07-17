import { type Ent, idOf } from '../../types.ts'
import { el } from '../ui.tsx'
import { menu, navigate } from '../nav.tsx'

let Chip = el('a', 'Id')

// The universal id chip: T-7, P-2, … — and the universal LINK. A real
// anchor, so cmd/middle-click and open-in-new-tab are the browser's own;
// a plain click (tap included) navigates in place; right-click offers
// "open here" / "open in new tab" explicitly.
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
        navigate(href)
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
