// The worker that grows a level off the page's thread. Asked for a level and
// a voxel edge, it grows the level (terrain.ts `vale`), meshes each chunk
// (chunks.ts), and sends both back with their arrays handed over rather than
// copied. The page starts it (grown.ts); a deploy compiles it as an entry of
// its own, since the page script starts it.
import { chunks } from './chunks.ts'
import { buffers } from './mesh.ts'
import { vale } from './terrain.ts'

addEventListener(
  'message',
  (e: MessageEvent<{ id: string; voxel: number }>) => {
    let v = vale(e.data.id, e.data.voxel)
    let drawn = chunks(v)
    let handed = new Set<ArrayBuffer>(
      drawn.flatMap((c) => [
        ...buffers(c.solid),
        ...(c.small ? buffers(c.small) : []),
      ]),
    )
    postMessage({ v, drawn }, { transfer: [...handed] })
  },
)
