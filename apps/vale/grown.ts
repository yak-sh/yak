// A level grown for the page, off its thread, while the page keeps painting
// and talking to the store: one worker (grow.ts) grows the level's shape,
// then every worker meshes a share of its chunks at once, one per core the
// page can spare. The shape of a level the hero may walk into next can be
// grown ahead (`ahead`), so walking in waits only for the meshing. Where the
// workers cannot start or fail, the page grows the level itself, and the
// reason is reported.
import { type Chunk, chunks } from './chunks.ts'
import type { Ask } from './grow.ts'
import { type Vale, vale } from './terrain.ts'

/** A level and its chunks, meshed. */
export type Grown = { v: Vale; drawn: Chunk[] }

// How many workers mesh at once: a core each, less the page's own, up to four.
let HANDS = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1))

// The workers, started with the first level the page grows; each one's last
// ask, since an ask waits for the one before it on the same worker; and how
// to fail each ask a worker is answering.
let pool: Worker[] = []
let turns: Promise<unknown>[] = []
let answering = new Set<(e: Error) => void>()
let hands = () =>
  pool.length ? pool : pool = Array.from(
    { length: HANDS },
    () => new Worker(new URL('./grow.ts', import.meta.url), { type: 'module' }),
  )

// Worker `n`'s answer to one ask, or why it could not give one.
let ask = <T>(n: number, a: Ask): Promise<T> => {
  let answer = (turns[n] ?? Promise.resolve()).catch(() => {}).then(() =>
    new Promise<T>((done, fail) => {
      let w = hands()[n]
      answering.add(fail)
      w.onmessage = (e) => {
        answering.delete(fail)
        done(e.data)
      }
      w.onerror = (e) => {
        e.preventDefault()
        answering.delete(fail)
        fail(new Error(`grow.ts: ${e.message || 'the worker did not start'}`))
      }
      w.postMessage(a)
    })
  )
  turns[n] = answer
  return answer
}

// An ask that failed because another failure stopped the pool, which is the
// one reported.
class Stopped extends Error {}

// A failed worker: every ask still being answered fails with it, the pool
// goes, to start afresh on the next ask, and why is reported.
let broke = (e: unknown) => {
  if (e instanceof Stopped) return
  for (let fail of answering) fail(new Stopped('grow.ts: its pool stopped'))
  answering.clear()
  for (let w of pool) w.terminate()
  pool = []
  turns = []
  reportError(e)
}

// Each level's shape, grown or growing, until the page grows a level.
let shapes = new Map<string, Promise<Vale>>()
let shape = (id: string, voxel: number) => {
  let key = `${id}@${voxel}`
  let s = shapes.get(key)
  if (s) return s
  s = ask<{ v: Vale }>(0, { id, voxel }).then((a) => a.v)
  shapes.set(key, s)
  s.catch(() => shapes.delete(key))
  return s
}

/** Start growing the shape of level `id`, where the hero may walk next. */
export let ahead = (id: string, voxel: number) => {
  shape(id, voxel).catch(broke)
}

/** Grow level `id` at voxel edge `voxel`. */
export let grown = async (id: string, voxel: number): Promise<Grown> => {
  try {
    let v = await shape(id, voxel)
    let n = hands().length
    let parts = await Promise.all(
      Array.from(
        { length: n },
        (_, part) => ask<{ drawn: Chunk[] }>(part, { v, part, of: n }),
      ),
    )
    return { v, drawn: parts.flatMap((p) => p.drawn) }
  } catch (e) {
    broke(e)
    let v = vale(id, voxel)
    return { v, drawn: chunks(v) }
  } finally {
    // What was grown ahead of this level is not ahead of the next.
    shapes.clear()
  }
}
