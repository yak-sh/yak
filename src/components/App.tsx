import { rootCanvas } from '../live.ts'
import { Canvas } from './Canvas.tsx'

// The page: a header and the root canvas, rendered straight from the cache.
export let App = () => {
  let root = rootCanvas()
  return (
    <main class='App'>
      <h1>
        Tasks <span class='sub'>· the fleet entity graph</span>
      </h1>
      {root && <Canvas eid={root} />}
    </main>
  )
}
