import { type Ent, type Pinned } from '../db.ts'
import { applicable, view } from './views.tsx'

// A card: one entity through one chosen lens, framed by a tab per matching
// lens. Static for now — tab click and drag-to-spawn arrive as the first
// island; the data model (card + pin) already supports both.
export let Card = ({ p, e }: { p: Pinned; e: Ent }) => {
  let V = view(p.view).View
  let at = `left:${p.x}px;top:${p.y}px;` + (p.w ? `width:${p.w}px;` : '')
  return (
    <section class='Card' style={at}>
      <header class='Card_Tabs'>
        {applicable(e).map((v) => (
          <span class={v.id == p.view ? 'Tab Tab-on' : 'Tab'} key={v.id}>
            {v.id}
          </span>
        ))}
      </header>
      <V e={e} />
    </section>
  )
}
