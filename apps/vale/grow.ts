// A worker that grows the world off the page's thread. Asked for a chunk, it
// grows that chunk's ground at the voxel edge asked and meshes it (chunks.ts),
// and sends the chunk back with its arrays handed over rather than copied,
// and the ground it grew. Asked for a chart, it paints the world's ground
// over a square (chart.ts). The page runs a few of these at once (grown.ts); a
// deploy compiles this file as an entry of its own, since the page script
// starts it.
import { chart } from './chart.ts'
import { type Chunk, chunk } from './chunks.ts'
import { buffers } from './mesh.ts'
import { vale } from './terrain.ts'

/** What the page asks of a worker: one chunk, grown at a voxel edge, with
 * its small things or without; or a chart of the square `size` metres on a
 * side from (x, z), a pixel every `m` metres. Each ask is numbered (`n`), and
 * its answer names it. */
export type Ask =
  | { voxel: number; ci: number; ck: number; small: boolean }
  | { chart: [number, number, number]; m: number }

/** What a worker answers: the number of the ask, and the chunk or the chart
 * it asked for. */
export type Answer = {
  n: number
  drawn?: Chunk
  px?: Uint8ClampedArray<ArrayBuffer>
}

addEventListener('message', (e: MessageEvent<Ask & { n: number }>) => {
  let a = e.data
  if ('chart' in a) {
    let px = chart(...a.chart, a.m)
    let answer: Answer = { n: a.n, px }
    return postMessage(answer, { transfer: [px.buffer] })
  }
  let drawn = chunk(vale(a.voxel), a.ci, a.ck, a.small)
  let handed = [
    ...buffers(drawn.solid),
    ...(drawn.small ? buffers(drawn.small) : []),
  ]
  let answer: Answer = { n: a.n, drawn }
  postMessage(answer, { transfer: handed })
})
