// The papers pinned on each village's notice board (notices.ts), over the
// plank its model draws bare (props/village.ts `board`): one for each notice
// it holds for the hero, up to as many as its face has room for, each a
// sheet with a few lines of writing and a red pin. And over the board the
// hero stands at, a plate saying what it is and how to read it, as one says
// so over a station (nodes.ts).
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import type { overlay } from './fx.ts'
import { glyphText } from './glyphs.ts'
import { cuboid, type Out, out, pack } from './mesh.ts'
import { type Board, boardsNear } from './notices.ts'
import { geometry, sight, soft } from './soft.ts'
import type { Spot, Vale } from './terrain.ts'
import type { Job } from './work.ts'

// Where each paper is pinned on a board's face, in metres from its foot,
// east and up, and how wide and tall it is: the first the largest, and each
// after it fitted in beside the others.
let SPOTS: [number, number, number, number][] = [
  [-0.85, 1.62, 0.55, 0.62],
  [0.18, 1.28, 0.48, 0.58],
  [-0.2, 1.98, 0.4, 0.44],
  [0.46, 1.94, 0.42, 0.44],
]
// How far south of its foot the face of a board's plank is, in metres.
let FACE = 0.125
let PAPER = [0xf4ecd6, 0xefe2c0, 0xf7f0de, 0xe9dcc0]
let INK = 0x8a7a60
let PIN = 0xc2573e
// How high over a board's foot its plate rides, in metres.
let HIGH = 3
// How far off a board's papers are drawn, in metres.
let SEEN = 60

/** The papers `n` notices pin on a board, with its foot at the origin: one
 * for each, while there is room.
 *
 * ```ts
 * import { assert, assertEquals } from '@std/assert'
 * let n = (k: number) => pinnedOn(k).pos.length
 * assertEquals(n(0), 0)
 * assert(n(1) < n(2))
 * // a full board takes no more
 * assertEquals(n(40), n(41))
 * ```
 */
export let pinnedOn = (n: number): Out => {
  let o = out()
  SPOTS.slice(0, n).forEach(([x, y, w, h], i) => {
    // Each a hair in front of the one before, so none shows through another.
    let z = FACE + i * 0.004
    cuboid(o, [x, y, z], [w, h, 0.015], PAPER[i], 0.05, 0.004)
    for (let l = 0; l < 3; l++) {
      let long = w - 0.14 - (l == 2 ? w / 3 : 0)
      cuboid(
        o,
        [x + 0.07, y + h - 0.17 - l * 0.11, z + 0.015],
        [long, 0.025, 0.004],
        INK,
        0.05,
        0,
      )
    }
    cuboid(
      o,
      [x + w / 2 - 0.03, y + h - 0.09, z + 0.015],
      [0.06, 0.06, 0.04],
      PIN,
      0.03,
      0.01,
    )
  })
  return o
}

/** The papers on the notice boards within sight of the hero, in `scene`,
 * over the ground of `v`; a phone's player has a button to read a board, and
 * is not told of a key. */
export let papers = (
  scene: THREE.Scene,
  v: Vale,
  plates: ReturnType<typeof overlay>,
  phone: boolean,
) => {
  let mat = soft({ speckle: 0.05, see: true })
  let made = new Map<number, THREE.BufferGeometry>()
  let geo = (n: number) => {
    let g = made.get(n)
    if (!g) made.set(n, g = geometry(pack(pinnedOn(n))))
    return g
  }
  // The boards in sight, by where they stand, each with its papers.
  let up = new Map<string, THREE.Mesh>()

  return {
    /** pin on each board in sight of `at` as many papers as `count` says it
     * holds, and plate the one the hero is at */
    tick: ([x, z]: Spot, count: (b: Board) => number, job: Job) => {
      let seen = new Set<string>()
      for (let b of boardsNear(v, x, z, SEEN)) {
        let key = b.at.join()
        let m = up.get(key)
        if (!m) {
          m = new THREE.Mesh(geo(0), mat)
          m.position.set(...b.at)
          m.rotation.y = b.turn * Math.PI / 2
          m.receiveShadow = true
          scene.add(m)
          up.set(key, m)
        }
        seen.add(key)
        let n = count(b)
        m.geometry = geo(Math.min(n, SPOTS.length))
        let at = job.board
        if (at?.at.join() != key || job.near || job.bench) continue
        plates.plate(
          `board:${key}`,
          new THREE.Vector3(b.at[0], b.at[1] + HIGH, b.at[2]),
          `<span><b>Notice board</b> <em>${glyphText('notices')} ${
            n ? `${n} to read` : 'Read'
          }${phone ? '' : ' · E'}</em></span>`,
          'Plate Plate-node',
        )
      }
      for (let [key, m] of up) {
        if (seen.has(key)) continue
        scene.remove(m)
        up.delete(key)
      }
    },
    /** keep the camera's sight of the hero clear (world.ts `see`) */
    see: (from: THREE.Vector3, feet: THREE.Vector3, tall: number) =>
      sight(mat, from, feet, tall),
  }
}
