// A worker that grows levels off the page's thread. Asked for a level and a
// voxel edge, it grows the level (terrain.ts `vale`) and sends it back; handed
// a grown level and a share, it meshes that share of the chunks (chunks.ts)
// and sends them back with their arrays handed over rather than copied. The
// page runs a few of these at once (grown.ts); a deploy compiles this file as
// an entry of its own, since the page script starts it.
import { chunks } from './chunks.ts'
import { buffers } from './mesh.ts'
import { type Vale, vale } from './terrain.ts'

/** What the page asks of a worker. */
export type Ask =
  | { id: string; voxel: number }
  | { v: Vale; part: number; of: number }

addEventListener('message', (e: MessageEvent<Ask>) => {
  let a = e.data
  if ('id' in a) return postMessage({ v: vale(a.id, a.voxel) })
  let drawn = chunks(a.v, a.part, a.of)
  let handed = new Set<ArrayBuffer>(
    drawn.flatMap((c) => [
      ...buffers(c.solid),
      ...(c.small ? buffers(c.small) : []),
    ]),
  )
  postMessage({ drawn }, { transfer: [...handed] })
})
