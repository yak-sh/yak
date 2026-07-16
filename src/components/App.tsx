import { rootCanvas } from '../live.ts'
import { el } from './ui.tsx'
import { Canvas } from './Canvas.tsx'

let Frame = el('main', 'App')
let Sub = el('span', 'App_Sub')

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
