// The map of the level the hero is in, north up. Its ground is painted from
// the same numbers that grow the level (terrain.ts), once a level: what tops
// each column, water by its depth, hills shaded as if lit from the
// north-west, what stands tall as a darker round, and what is built in the
// colour of a roof (`paint`). Over it, who is where, written only while it is
// open: the hero's arrow, the other players, the people with a quest, and
// the level each road leads to. M or the compass opens it; M, Escape, a tap
// beside it or its close button folds it away.
import { paletteOf } from './ground.ts'
import { LEVELS } from './levels.ts'
import type { Frame } from './play.ts'
import { bulk, KINDS } from './props.ts'
import { clamp } from './rand.ts'
import { SIZE, type Vale, WATER } from './terrain.ts'

// What is built, seen from above.
let ROOF = 0xa9553a
// How tall a prop stands before the map shows it, in metres.
let TALL = 1.2
// How deep water is before it is drawn at its deepest, in metres.
let DEPTH = 2.5

let bytes = (hex: number) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]

/** A level's chart: a pixel for each column of its ground, as RGBA, `v.cols`
 * on a side, north at the top.
 *
 * ```ts
 * import { assert } from '@std/assert'
 * import { vale } from './terrain.ts'
 * let v = vale('mossvale', 1)
 * let px = paint(v)
 * let at = ([x, z]: [number, number]) => {
 *   let i = (Math.floor(x) + Math.floor(z) * v.cols) * 4
 *   return [px[i], px[i + 1], px[i + 2]]
 * }
 * let [r, g, b] = at(v.places.lake)
 * assert(b > r && b > g) // the lake is water
 * ;[r, g, b] = at(v.places.fields)
 * assert(g > b) // the fields are not
 * ```
 */
export let paint = (v: Vale): Uint8ClampedArray<ArrayBuffer> => {
  let N = v.cols, V = v.voxel
  let { tops, water } = paletteOf(v.level)
  let [deep, shallow] = water.map(bytes)
  let px = new Uint8ClampedArray(N * N * 4)
  let H = (i: number, k: number) =>
    v.h[clamp(i, 0, N - 1) + clamp(k, 0, N - 1) * N] * V
  let put = (at: number, rgb: number[], k = 1) => {
    px[at * 4] = rgb[0] * k
    px[at * 4 + 1] = rgb[1] * k
    px[at * 4 + 2] = rgb[2] * k
    px[at * 4 + 3] = 255
  }
  for (let k = 0; k < N; k++) {
    for (let i = 0; i < N; i++) {
      let h = H(i, k), at = i + k * N
      if (h <= WATER) {
        let d = clamp((WATER - h) / DEPTH, 0, 1)
        put(at, shallow.map((c, n) => c + (deep[n] - c) * d))
        continue
      }
      // Lit from the north-west: brighter where the ground rises to the
      // south-east.
      let rise = (H(i + 1, k) - H(i - 1, k) + H(i, k + 1) - H(i, k - 1)) /
        (2 * V)
      put(at, bytes(tops[v.top[at]]), clamp(1 + rise * 0.25, 0.72, 1.18))
    }
  }
  // Every column in the rectangle `w` by `d` metres from (x, z).
  let cells = function* (x: number, z: number, w: number, d: number) {
    for (let k = Math.floor(z / V); k < Math.ceil((z + d) / V); k++) {
      for (let i = Math.floor(x / V); i < Math.ceil((x + w) / V); i++) {
        if (i >= 0 && k >= 0 && i < N && k < N) yield [i, k]
      }
    }
  }
  let roof = bytes(ROOF)
  for (let p of v.props) {
    let span = KINDS[p.kind].span
    if (span) {
      let [w, d] = span
      for (let [i, k] of cells(p.x - w / 2, p.z - d / 2, w, d)) {
        put(i + k * N, roof)
      }
      continue
    }
    let { r, tall } = bulk(p.kind, p.seed)
    if (tall < TALL) continue
    for (let [i, k] of cells(p.x - r, p.z - r, 2 * r, 2 * r)) {
      let dx = (i + 0.5) * V - p.x, dz = (k + 0.5) * V - p.z
      if (dx * dx + dz * dz > r * r) continue
      let at = i + k * N
      // Darker, and darker still on the side away from the light.
      let dim = dx + dz > 0 ? 0.62 : 0.74
      put(at, [px[at * 4], px[at * 4 + 1], px[at * 4 + 2]], dim)
    }
  }
  return px
}

// Where a point in the level sits on the map, as a percentage across and
// down.
let pct = (m: number) => `${(clamp(m / SIZE, 0, 1) * 100).toFixed(2)}%`

let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** The map, folded away until asked for, in `root`. */
export let map = (root: HTMLElement) => {
  let box = document.createElement('div')
  box.className = 'Map'
  box.hidden = true
  box.innerHTML =
    `<div class=Map_Sheet><div class=Map_Head><b class=Map_Name></b>` +
    `<button class=Map_Close title="Close the map (M)">✕</button></div>` +
    `<div class=Map_Chart><canvas class=Map_Ground></canvas><div class=Map_Marks></div></div></div>`
  root.append(box)
  let name = box.querySelector<HTMLElement>('.Map_Name')!
  let canvas = box.querySelector('canvas')!
  let marks = box.querySelector<HTMLElement>('.Map_Marks')!
  let close = () => box.hidden = true
  box.addEventListener('pointerdown', (e) => {
    e.stopPropagation()
    let t = e.target
    if (t == box || (t instanceof Element && t.closest('.Map_Close'))) close()
  })
  addEventListener('keydown', (e) => {
    if (e.code == 'Escape' && !box.hidden) close()
  })

  // What the chart shows: the level it was painted for, at its voxel size.
  let painted: Vale | null = null
  let was = ''
  let draw = (v: Vale) => {
    if (painted == v) return
    painted = v
    canvas.width = canvas.height = v.cols
    let ctx = canvas.getContext('2d')!
    ctx.putImageData(new ImageData(paint(v), v.cols, v.cols), 0, 0)
    name.textContent = v.level.name
    was = ''
  }

  return {
    get open() {
      return !box.hidden
    },
    toggle: () => box.hidden = !box.hidden,
    close,
    /** mark who is where this frame, when the map is open */
    show: (f: Frame, v: Vale) => {
      if (box.hidden) return
      draw(v)
      let at = (x: number, z: number) => `left:${pct(x)};top:${pct(z)}`
      let html =
        v.roads.map((r) =>
          `<span class="Map_Road Map_Road-${r.side}" style="${at(r.x, r.z)}">${
            esc(LEVELS[r.to]?.name ?? r.to)
          }</span>`
        ).join('') +
        f.givers.map((g) =>
          `<i class="Map_Giver${g.mark ? ' Map_Giver-quest' : ''}" style="${
            at(g.x, g.z)
          }" title="${esc(g.name)}">${g.mark}</i>`
        ).join('') +
        f.others.map((o) =>
          `<i class=Map_Other style="${at(o.body.x, o.body.z)}" title="${
            esc(o.name)
          }"></i>`
        ).join('') +
        // The hero's arrow points the way they face: (sin yaw, cos yaw) on
        // the ground, which is π − yaw clockwise from north.
        `<i class=Map_Me style="${at(f.body.x, f.body.z)};--turn:${
          Math.round((Math.PI - f.body.yaw) * 180 / Math.PI)
        }deg"></i>`
      if (html == was) return
      was = html
      marks.innerHTML = html
    },
  }
}
