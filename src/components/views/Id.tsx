import { type Ent, idOf } from '../../types.ts'
import { el } from '../ui.tsx'
import { navigate } from '../nav.tsx'

let Chip = el('a', 'Id')

// The universal id chip: T-7, P-2, … — and the universal LINK. A real
// anchor: cmd/middle-click, and the browser's OWN context menu, do all
// the new-tab forms; a plain click (tap included) navigates in place.
// The custom "open here" menu belongs to the CARD, not to links.
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
    >
      {idOf(e)}
    </Chip>
  )
}
