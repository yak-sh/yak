import { bundle, db, type Pinned } from '../db.ts'
import { applicable, View } from './View.tsx'

// A card: one entity through one chosen lens, framed by a tab per matching
// lens. Static for now — tab click and drag-to-spawn arrive as the first
// island; the data model (card + pin) already supports both.
export let Card = ({ p }: { p: Pinned }) => {
  let at = `left:${p.x}px;top:${p.y}px;` + (p.w ? `width:${p.w}px;` : '')
  return (
    <section class='Card' style={at}>
      <header class='Card_Tabs'>
        {applicable(bundle(db, p.target_eid)).map((v) => (
          <span class={v.id == p.view ? 'Tab Tab-on' : 'Tab'} key={v.id}>
            {v.id}
          </span>
        ))}
      </header>
      <View eid={p.target_eid} view={p.view} />
    </section>
  )
}
