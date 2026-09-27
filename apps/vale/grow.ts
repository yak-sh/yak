// A worker that grows levels off the page's thread. Asked for a level's shape
// at a voxel edge, it grows the level (terrain.ts `vale`) and sends it back,
// or only grows it, ahead of a chunk asked of it. Asked for a chunk, it
// meshes that chunk of the level grown at the voxel edge asked (chunks.ts),
// growing the level first if it has not, and sends the chunk back with its
// arrays handed over rather than copied. The page runs a few of these at once
// (grown.ts); a deploy compiles this file as an entry of its own, since the
// page script starts it.
import { type Chunk, chunk } from './chunks.ts'
import { buffers } from './mesh.ts'
import { type Vale, vale } from './terrain.ts'

/** What the page asks of a worker: a level's shape, sent back or only grown
 * (`keep`); or one chunk of it. Each ask is numbered (`n`), and its answer
 * names it. */
export type Ask =
  | { shape: string; voxel: number; keep?: boolean }
  | {
    mesh: string
    voxel: number
    ci: number
    ck: number
    small: boolean
  }

/** What a worker answers: the number of the ask, and the shape or the chunk
 * it asked for, if it asked for one. */
export type Answer = { n: number; v?: Vale; drawn?: Chunk }

addEventListener('message', (e: MessageEvent<Ask & { n: number }>) => {
  let a = e.data
  if ('shape' in a) {
    let v = vale(a.shape, a.voxel)
    let answer: Answer = a.keep ? { n: a.n } : { n: a.n, v }
    return postMessage(answer)
  }
  let drawn = chunk(vale(a.mesh, a.voxel), a.ci, a.ck, a.small)
  let handed = [
    ...buffers(drawn.solid),
    ...(drawn.small ? buffers(drawn.small) : []),
  ]
  let answer: Answer = { n: a.n, drawn }
  postMessage(answer, { transfer: handed })
})
