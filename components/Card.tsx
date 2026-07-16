import { bundle, db, type Pinned } from '../db.ts'
import { applicable, View } from './View.tsx'

// A card: one entity through one chosen lens, framed by a tab per matching
// lens. Each tab is a button POSTing its lens for this card — no client JS.
// Drag-to-spawn arrives as the first island; card + pin already support it.
export let Card = ({ p }: { p: Pinned }) => {
  let at = `left:${p.x}px;top:${p.y}px;` + (p.w ? `width:${p.w}px;` : '')
  return (
    <section class='Card' style={at}>
      <form class='Card_Tabs' method='post' action={`/card/${p.card_eid}`}>
        {applicable(bundle(db, p.target_eid)).map((v) => (
          <button
            type='submit'
            class={v.id == p.view ? 'Tab Tab-on' : 'Tab'}
            name='view'
            value={v.id}
            key={v.id}
          >
            {v.id}
          </button>
        ))}
      </form>
      <View eid={p.target_eid} view={p.view} />
    </section>
  )
}
