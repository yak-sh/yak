import { define } from '../utils.ts'
import { db, pinned, rootCanvas } from '../db.ts'
import { Card } from '../components/Card.tsx'
import { Canvas } from '../islands/Canvas.tsx'
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
      <Canvas eid={canvas.eid}>
        {pinned(db, canvas.eid).map((p) => (
          <Drag key={p.eid} eid={p.eid} x={p.x} y={p.y} w={p.w}>
            <Card p={p} />
          </Drag>
        ))}
      </Canvas>
    </main>
  )
})
