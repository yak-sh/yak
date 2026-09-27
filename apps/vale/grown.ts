// Levels grown for the page, off its thread, while the page keeps painting
// and talking to the store: one worker (grow.ts) grows the level's shape for
// the page, and every worker meshes the chunks the page asks for, one per core
// the page can spare, each ask going to the worker with the fewest waiting.
// Each worker grows the level itself before it meshes a chunk of it, the same
// on every one. The shape of a level the hero may walk into next can be grown
// ahead in all of them (`ahead`), so walking in waits only for the meshing.
// Where the workers cannot start or fail, the page grows and meshes itself,
// and the reason is reported.
import { type Chunk, chunk } from './chunks.ts'
import type { Answer, Ask } from './grow.ts'
import { type Vale, vale } from './terrain.ts'

// How many workers mesh at once: a core each, less the page's own, up to four.
let HANDS = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1))

// The workers, started with the first ask, each with how many of its asks
// are waiting; and each ask still being answered, by its number.
type Hand = { w: Worker; load: number }
let pool: Hand[] = []
let asks = new Map<
  number,
  { done: (a: Answer) => void; fail: (e: Error) => void }
>()
let count = 0

// An ask that failed because another failure stopped the pool, which is the
// one reported.
class Stopped extends Error {}

// A failed worker: every ask still being answered fails with it, the pool
// goes, to start afresh on the next ask, and why is reported.
let broke = (e: unknown) => {
  if (e instanceof Stopped) return
  for (let { fail } of asks.values()) {
    fail(new Stopped('grow.ts: its pool stopped'))
  }
  asks.clear()
  for (let h of pool) h.w.terminate()
  pool = []
  reportError(e)
}

let hands = () =>
  pool.length ? pool : pool = Array.from({ length: HANDS }, () => {
    let hand: Hand = {
      w: new Worker(new URL('./grow.ts', import.meta.url), { type: 'module' }),
      load: 0,
    }
    hand.w.onmessage = (e) => {
      hand.load--
      let a = asks.get(e.data.n)
      asks.delete(e.data.n)
      a?.done(e.data)
    }
    hand.w.onerror = (e) => {
      e.preventDefault()
      broke(new Error(`grow.ts: ${e.message || 'the worker did not start'}`))
    }
    return hand
  })

// One ask of worker `to`, or of the one with the fewest waiting.
let ask = (a: Ask, to?: number): Promise<Answer> =>
  new Promise((done, fail) => {
    let hs = hands()
    let hand = to != null
      ? hs[to]
      : hs.reduce((best, h) => h.load < best.load ? h : best)
    let n = count++
    asks.set(n, { done, fail })
    hand.load++
    hand.w.postMessage({ ...a, n })
  })

// Each level's shape, grown or growing, until the page grows a level.
let shapes = new Map<string, Promise<Vale>>()
let shape = (id: string, voxel: number) => {
  let key = `${id}@${voxel}`
  let s = shapes.get(key)
  if (s) return s
  s = ask({ shape: id, voxel }, 0).then((a) => a.v ?? vale(id, voxel))
  shapes.set(key, s)
  s.catch(() => shapes.delete(key))
  return s
}

/** Start growing the shape of level `id` in every worker, where the hero may
 * walk next. */
export let ahead = (id: string, voxel: number) => {
  shape(id, voxel).catch(broke)
  for (let to = 1; to < hands().length; to++) {
    ask({ shape: id, voxel, keep: true }, to).catch(broke)
  }
}

/** Level `id`'s shape, grown at voxel edge `voxel`. */
export let grown = async (id: string, voxel: number): Promise<Vale> => {
  try {
    return await shape(id, voxel)
  } catch (e) {
    broke(e)
    return vale(id, voxel)
  } finally {
    // What was grown ahead of this level is not ahead of the next.
    shapes.clear()
  }
}

/** Chunk (ci, ck) of level `id` grown at voxel edge `voxel`, meshed, with its
 * small things when `small` asks for them. */
export let meshed = async (
  id: string,
  voxel: number,
  ci: number,
  ck: number,
  small: boolean,
): Promise<Chunk> => {
  try {
    let a = await ask({ mesh: id, voxel, ci, ck, small })
    return a.drawn ?? chunk(vale(id, voxel), ci, ck, small)
  } catch (e) {
    broke(e)
    return chunk(vale(id, voxel), ci, ck, small)
  }
}
