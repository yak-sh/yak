// The world grown for the page, off its thread, while the page keeps painting
// and talking to the store: every worker (grow.ts) grows and meshes the chunks
// the page asks for, one per core the page can spare, each ask going to the
// worker with the fewest waiting, and paints the map's chart when asked.
// Where the workers cannot start or fail, the page grows and paints itself,
// and the reason is reported.
import { chart } from './chart.ts'
import { veil } from './mapfog.ts'
import { type Chunk, chunk } from './chunks.ts'
import type { Answer, Ask } from './grow.ts'
import { pack, type Packed } from './mesh.ts'
import type { Bundle } from './net.ts'
import { model } from './props.ts'
import {
  type Affects,
  installBuildingDesigns,
  installThemeDesigns,
  vale,
} from './terrain.ts'

// How many workers mesh at once: a core each, less the page's own, up to four.
export let capacity = Math.max(
  1,
  Math.min(4, (navigator.hardwareConcurrency || 2) - 1),
)

// The workers, started with the first ask, each with how many of its asks
// are waiting; and each ask still being answered, by its number.
type Hand = { w: Worker; load: number }
let pool: Hand[] = []
let themes: Bundle[] = []
let buildingDesigns: Bundle[] | null = null
// The map's pixels depend on both sets of designs.
export let chartVersion = 0

/** Give each world Worker the same building plans the page is using. */
export let useBuildingDesigns = (rows: Bundle[]): {
  affects: Affects
  kinds: Set<string>
} => {
  chartVersion++
  buildingDesigns = rows
  let impact = installBuildingDesigns(rows)
  for (let hand of pool) hand.w.postMessage({ buildingDesigns: rows })
  return impact
}
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
  pool.length ? pool : pool = Array.from({ length: capacity }, () => {
    let hand: Hand = {
      w: new Worker(new URL('./grow.ts', import.meta.url), { type: 'module' }),
      load: 0,
    }
    if (buildingDesigns) hand.w.postMessage({ buildingDesigns })
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
    if (themes.length) hand.w.postMessage({ themes })
    return hand
  })

/** Keep the page and each growth worker on the store's region designs. */
export let useThemeRows = (rows: Bundle[]): Affects => {
  chartVersion++
  themes = rows
  let affects = installThemeDesigns(rows)
  for (let hand of pool) hand.w.postMessage({ themes: rows })
  return affects
}

// One ask of the worker with the fewest waiting.
let ask = (a: Ask): Promise<Answer> =>
  new Promise((done, fail) => {
    let hand = hands().reduce((best, h) => h.load < best.load ? h : best)
    let n = count++
    asks.set(n, { done, fail })
    hand.load++
    hand.w.postMessage({ ...a, n })
  })

/** Chunk (ci, ck) of the world grown at voxel edge `voxel`, meshed, with its
 * small things when `small` asks for them. */
export let meshed = async (
  voxel: number,
  ci: number,
  ck: number,
  small: boolean,
): Promise<Chunk> => {
  try {
    let a = await ask({ voxel, ci, ck, small })
    return a.drawn ?? chunk(vale(voxel), ci, ck, small)
  } catch (e) {
    broke(e)
    return chunk(vale(voxel), ci, ck, small)
  }
}

/** A model meshed off the page, sent once for each visible shape. */
export let template = async (
  kind: string,
  seed: number,
  turn: number,
  near: boolean,
): Promise<Packed> => {
  try {
    let a = await ask({ template: [kind, seed, turn, near] })
    return a.template ?? pack(model(kind, seed, turn, near))
  } catch (e) {
    broke(e)
    return pack(model(kind, seed, turn, near))
  }
}

/** The world's chart over the square `size` metres on a side from (x, z), a
 * pixel every `m` metres (chart.ts). */
export let charted = async (
  x: number,
  z: number,
  size: number,
  m: number,
): Promise<Uint8ClampedArray<ArrayBuffer>> => {
  try {
    let a = await ask({ chart: [x, z, size], m })
    return a.px ?? chart(x, z, size, m)
  } catch (e) {
    broke(e)
    return chart(x, z, size, m)
  }
}

/** The irregular region veil, sampled by the world's worker. */
export let fogged = async (
  box: [number, number, number],
  visited: ReadonlySet<string>,
): Promise<Uint8ClampedArray<ArrayBuffer>> => {
  try {
    let a = await ask({ fog: box, visited: [...visited] })
    return a.fog ?? veil(box, visited)
  } catch (e) {
    broke(e)
    return veil(box, visited)
  }
}
