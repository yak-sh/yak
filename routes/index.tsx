import { define } from '../utils.ts'
import { db, pinned, rootCanvas } from '../db.ts'
import { Card } from '../components/Card.tsx'

// The root is a canvas entity; everything on screen is a pinned card viewing
// some entity through some lens (the Board is just one of them).
export default define.page(function Home() {
  let canvas = rootCanvas(db)
  return (
    <main class='wrap wrap-wide'>
      <h1>
        Tasks v2 <span class='sub'>· the fleet entity graph</span>
      </h1>
      <div class='Canvas'>
        {pinned(db, canvas.eid).map((p) => <Card key={p.card_eid} p={p} />)}
      </div>
    </main>
  )
})
