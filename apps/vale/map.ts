// The map of the region the hero is in and the ground round it, north up:
// its chart painted off the page's thread (chart.ts), once a region. Over it,
// who is where, written only while it is open: the hero's arrow, the other
// players, the people with a quest, the nodes to gather (work.ts), coloured
// by their trade and hollow while spent, where each road leaves the map and
// the region it leads to, and a ring where each quest tracked goes next
// (journal.ts). What lies off the map is marked at its edge, the way it lies.
// M or the compass opens its panel.
import { charted } from './grown.ts'
import type { Mark } from './journal.ts'
import { LEVELS, type Side, SIZE, type Spot } from './levels.ts'
import type { Panel } from './panel.ts'
import type { Frame } from './play.ts'
import { clamp } from './rand.ts'
import { originOf } from './regions.ts'
import { tipped } from './tip.ts'
import { arriveOf, roadsOf } from './ways.ts'
import type { Seen } from './work.ts'

// How far past the region's cell the map shows, in metres, and how many
// metres a pixel of its chart is.
let MARGIN = 32
let M = 1

let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

// The square a region's map shows: its north-west corner, and its side, in
// metres.
type Box = [number, number, number]
let boxOf = (id: string): Box => {
  let [ox, oz] = originOf(id)
  return [ox - MARGIN, oz - MARGIN, SIZE + 2 * MARGIN]
}

/** Where each road out of a region leaves its map, the side it leaves by,
 * and the region it leads to.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let west = exits('mossvale').find((e) => e.to == 'birchmere')!
 * assertEquals([west.side, west.at[0]], ['west', -32])
 * ```
 */
export let exits = (id: string): { at: Spot; side: Side; to: string }[] => {
  let [x0, z0, size] = boxOf(id)
  let x1 = x0 + size, z1 = z0 + size
  return roadsOf(id).flatMap((r) => {
    let to = r.from == id ? r.to : r.from
    let path: Spot[] = [
      arriveOf(r.from),
      ...Array.from(r.c.xs, (x, i): Spot => [x, r.c.zs[i]]),
      arriveOf(r.to),
    ]
    for (let j = 0; j < path.length; j++) {
      let [x, z] = path[r.from == id ? j : path.length - 1 - j]
      if (x > x0 && x < x1 && z > z0 && z < z1) continue
      let side: Side = x <= x0
        ? 'west'
        : x >= x1
        ? 'east'
        : z <= z0
        ? 'north'
        : 'south'
      return [{ at: [clamp(x, x0, x1), clamp(z, z0, z1)] as Spot, side, to }]
    }
    return []
  })
}

/** The map, drawn into its panel (panel.ts). */
export let map = (panel: Panel) => {
  panel.body.innerHTML =
    `<div class=Map><canvas class=Map_Ground></canvas><div class=Map_Marks></div></div>`
  let canvas = panel.body.querySelector('canvas')!
  let marks = panel.body.querySelector<HTMLElement>('.Map_Marks')!

  // What the chart shows: the region it was painted for, and its square.
  let shown = ''
  let box: Box = [0, 0, SIZE]
  let was = ''
  let draw = (id: string) => {
    if (shown == id) return
    shown = id
    box = boxOf(id)
    panel.head(esc(LEVELS[id]?.name ?? id))
    was = ''
    charted(...box, M).then((px) => {
      if (shown != id) return
      let n = Math.round(box[2] / M)
      canvas.width = canvas.height = n
      canvas.getContext('2d')!.putImageData(new ImageData(px, n, n), 0, 0)
    }).catch(reportError)
  }
  // Where a point sits on the map, as a percentage across and down.
  let pct = (m: number, from: number) =>
    `${(clamp((m - from) / box[2], 0, 1) * 100).toFixed(2)}%`

  return {
    /** mark who is where this frame, the nodes, and where each quest tracked
     * goes next, when the map is open */
    show: (f: Frame, nodes: Seen[] = [], goals: Mark[] = []) => {
      if (!panel.open) return
      draw(f.level)
      let at = (x: number, z: number) =>
        `left:${pct(x, box[0])};top:${pct(z, box[1])}`
      let html =
        goals.map((g) =>
          `<i class=Map_Goal style="${at(...g.at)}"${
            tipped({ name: g.title })
          }></i>`
        ).join('') +
        nodes.map((n) =>
          `<i class="Map_Node Map_Node-${n.lode.trade}${
            n.spent ? ' Map_Node-spent' : ''
          }${n.able ? '' : ' Map_Node-far'}" style="${at(n.at[0], n.at[2])}"${
            tipped({ name: n.lode.name })
          }></i>`
        ).join('') +
        exits(f.level).map((r) =>
          `<span class="Map_Road Map_Road-${r.side}" style="${at(...r.at)}">${
            esc(LEVELS[r.to]?.name ?? r.to)
          }</span>`
        ).join('') +
        f.givers.map((g) =>
          `<i class="Map_Giver${g.mark ? ' Map_Giver-quest' : ''}" style="${
            at(g.x, g.z)
          }"${tipped({ name: g.name })}>${g.mark}</i>`
        ).join('') +
        f.others.map((o) =>
          `<i class=Map_Other style="${at(o.body.x, o.body.z)}"${
            tipped({ name: o.name })
          }></i>`
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
