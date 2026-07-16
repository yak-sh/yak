import { define } from '../utils.ts'
import { db, pinned, rootCanvas } from '../db.ts'
import { Card } from '../components/Card.tsx'
import { Drag } from '../islands/Drag.tsx'

// The root is a canvas entity; everything on screen is a pinned card viewing
// some entity through some lens (the Board is just one of them). The card
// content is server-rendered; the Drag island owns only the geometry.
export default define.page(function Home() {
  let canvas = rootCanvas(db)
  return (
    <main class='App'>
      <h1>
        Tasks <span class='sub'>· the fleet entity graph</span>
      </h1>
      <div class='Canvas'>
        {pinned(db, canvas.eid).map((p) => (
          <Drag
            key={p.eid}
            eid={p.eid}
            canvas={p.canvas_eid}
            x={p.x}
            y={p.y}
            w={p.w}
            h={p.h}
          >
            <Card p={p} />
          </Drag>
        ))}
      </div>
    </main>
  )
})
