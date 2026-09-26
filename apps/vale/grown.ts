// A level grown for the page, off its thread, while the page keeps painting
// and talking to the store: one worker (grow.ts) grows the level, then every
// worker meshes a share of its chunks at once, one per core the page can spare.
// Where the workers cannot start or fail, the page grows the level itself, and
// the reason is reported.
import { type Chunk, chunks } from './chunks.ts'
import type { Ask } from './grow.ts'
import { type Vale, vale } from './terrain.ts'

/** A level and its chunks, meshed. */
export type Grown = { v: Vale; drawn: Chunk[] }

// How many workers mesh at once: a core each, less the page's own, up to four.
let HANDS = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1))

// The workers, for the page's life, started with the first level it grows.
let pool: Worker[] = []
let hands = () =>
  pool.length ? pool : pool = Array.from(
    { length: HANDS },
    () => new Worker(new URL('./grow.ts', import.meta.url), { type: 'module' }),
  )

// A worker's answer to one ask, or why it could not give one.
let ask = <T>(w: Worker, a: Ask): Promise<T> =>
  new Promise((done, fail) => {
    w.onmessage = (e) => done(e.data)
    w.onerror = (e) => {
      e.preventDefault()
      fail(new Error(`grow.ts: ${e.message || 'the worker did not start'}`))
    }
    w.postMessage(a)
  })

/** Grow level `id` at voxel edge `voxel`, one level at a time. */
export let grown = async (id: string, voxel: number): Promise<Grown> => {
  try {
    let ws = hands()
    let { v } = await ask<{ v: Vale }>(ws[0], { id, voxel })
    let parts = await Promise.all(
      ws.map((w, part) =>
        ask<{ drawn: Chunk[] }>(w, { v, part, of: ws.length })
      ),
    )
    return { v, drawn: parts.flatMap((p) => p.drawn) }
  } catch (e) {
    for (let w of pool) w.terminate()
    pool = []
    reportError(e)
    let v = vale(id, voxel)
    return { v, drawn: chunks(v) }
  }
}
