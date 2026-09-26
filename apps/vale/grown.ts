// A level grown for the page, off its thread: a worker (grow.ts) grows the
// level and meshes its chunks while the page keeps painting and talking to
// the store. Where a worker cannot start, the page grows it itself, and the
// reason is reported.
import { type Chunk, chunks } from './chunks.ts'
import { type Vale, vale } from './terrain.ts'

/** A level and its chunks, meshed. */
export type Grown = { v: Vale; drawn: Chunk[] }

// One worker for the page's life, started with the first level it grows.
let worker: Worker | null = null

// What the worker would have sent, grown on the page's own thread.
let here = (id: string, voxel: number): Grown => {
  let v = vale(id, voxel)
  return { v, drawn: chunks(v) }
}

let start = () =>
  worker ??= new Worker(new URL('./grow.ts', import.meta.url), {
    type: 'module',
  })

/** Grow level `id` at voxel edge `voxel`, one level at a time. */
export let grown = (id: string, voxel: number): Promise<Grown> =>
  new Promise((done) => {
    let w: Worker
    try {
      w = start()
    } catch (e) {
      reportError(e)
      return done(here(id, voxel))
    }
    let off = () => {
      w.onmessage = null
      w.onerror = null
    }
    w.onmessage = (e: MessageEvent<Grown>) => {
      off()
      done(e.data)
    }
    w.onerror = (e) => {
      off()
      e.preventDefault()
      w.terminate()
      worker = null
      reportError(
        new Error(`grow.ts: ${e.message || 'the worker did not start'}`),
      )
      done(here(id, voxel))
    }
    w.postMessage({ id, voxel })
  })
