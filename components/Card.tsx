import { bundle, db, type Pinned } from '../db.ts'
import { applicable, View } from './View.tsx'
import { Tabs } from '../islands/Tabs.tsx'

// A card: one entity through one chosen lens, framed by a tab per matching
// lens (the Tabs island owns switching). The scroller (not the card) owns
// the padding, so the scrollbar rides the card border and the padding
// scrolls away with the content.
export let Card = ({ p }: { p: Pinned }) => (
  <section class='Card'>
    <Tabs
      card={p.eid}
      target={p.target_eid}
      view={p.view}
      views={applicable(bundle(db, p.target_eid)).map((v) => v.id)}
    />
    <div class='Card_Scroll'>
      <View eid={p.target_eid} view={p.view} />
    </div>
  </section>
)
