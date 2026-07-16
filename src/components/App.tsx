import { rootCanvas } from '../live.ts'
import { block } from './ui.tsx'
import { Canvas } from './Canvas.tsx'

let Frame = block('main', 'App', { Sub: 'span' })
let { Sub } = Frame

// The page: a header and the root canvas, rendered straight from the cache.
export let App = () => {
  let root = rootCanvas()
  return (
    <Frame>
      <h1>
        Tasks <Sub>· the fleet entity graph</Sub>
      </h1>
      {root && <Canvas eid={root} />}
    </Frame>
  )
}
