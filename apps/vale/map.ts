// The map of the region the hero is in and the ground round it, north up:
// its chart painted off the page's thread (chart.ts), once a region. Over it,
// who is where, written only while it is open: the hero's arrow, the other
// players, the people with a quest, the nodes to gather (work.ts), coloured
// by their trade and hollow while spent, where each road leaves the map and
// the region it leads to, and a ring where each quest tracked goes next
// (journal.ts). What lies off the map is marked at its edge, the way it lies.
// M or the compass opens its panel.
import { charted } from './grown.ts'
import { glyph } from './glyphs.ts'
import type { Mark } from './journal.ts'
import { LEVELS, type Side, SIZE, type Spot } from './levels.ts'
import type { Panel } from './panel.ts'
import type { Frame } from './play.ts'
import { clamp } from './rand.ts'
import { tint } from './rarity.ts'
import { originOf } from './regions.ts'
import { tipped } from './tip.ts'
import { arriveOf, roadsOf } from './ways.ts'
import type { Seen } from './work.ts'
import { fireNear } from './fires.ts'
import { villageOf } from './terrain.ts'
import { REACH, revealed } from './explore.ts'

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
export let map = (panel: Panel, travel: (to: string) => void) => {
  panel.body.innerHTML =
    `<div class=Map_Wrap><div class=Map><canvas class=Map_Ground></canvas><canvas class=Map_Fog></canvas><div class=Map_Marks></div></div><div class=Map_Travel></div></div>`
  let canvas = panel.body.querySelector<HTMLCanvasElement>('.Map_Ground')!
  let fog = panel.body.querySelector<HTMLCanvasElement>('.Map_Fog')!
  let marks = panel.body.querySelector<HTMLElement>('.Map_Marks')!
  let choices = panel.body.querySelector<HTMLElement>('.Map_Travel')!
  let near = false
  let known = new Set<string>()
  choices.addEventListener('click', (e) => {
    let to = e.target instanceof Element
      ? e.target.closest<HTMLElement>('[data-fire]')?.dataset.fire
      : undefined
    if (!to || !near || !known.has(to)) return
    travel(to)
    panel.close()
  })

  // What the chart shows: the region it was painted for, and its square.
  let shown = ''
  let box: Box = [0, 0, SIZE]
  let was = ''
  let fogWas: ReadonlyArray<Spot> | null = null
  let fogCells: ReadonlyArray<Spot> | null = null
  let fogAt: Spot = [NaN, NaN]
  let points: Spot[] = []
  let local: Spot[] = []
  let localWas: ReadonlyArray<Spot> | null = null
  let choicesWas = ''
  let draw = (id: string) => {
    if (shown == id) return
    shown = id
    box = boxOf(id)
    panel.head(esc(LEVELS[id]?.name ?? id))
    was = ''
    fogWas = null
    fogCells = null
    localWas = null
    fog.width = fog.height = Math.round(box[2] / M)
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
  let uncover = (points: ReadonlyArray<Spot>) => {
    if (points == fogWas) return
    fogWas = points
    let ctx = fog.getContext('2d')!
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#22231f'
    ctx.fillRect(0, 0, fog.width, fog.height)
    ctx.globalCompositeOperation = 'destination-out'
    for (let [x, z] of points) {
      let cx = (x - box[0]) / M, cz = (z - box[1]) / M
      let r = REACH / M
      if (
        cx + r < 0 || cz + r < 0 || cx - r > fog.width ||
        cz - r > fog.height
      ) continue
      let shade = ctx.createRadialGradient(cx, cz, r - 5, cx, cz, r)
      shade.addColorStop(0, '#000')
      shade.addColorStop(1, 'transparent')
      ctx.fillStyle = shade
      ctx.beginPath()
      ctx.arc(cx, cz, r, 0, 2 * Math.PI)
      ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  return {
    /** mark who is where this frame, the nodes, and where each quest tracked
     * goes next, when the map is open */
    show: (
      f: Frame,
      nodes: Seen[] = [],
      goals: Mark[] = [],
      visited: ReadonlySet<string> = new Set(),
      explored: ReadonlyArray<Spot> = [],
    ) => {
      if (!panel.open) return
      draw(f.level)
      if (localWas != explored) {
        localWas = explored
        local = explored.filter(([x, z]) =>
          x + REACH >= box[0] && x - REACH <= box[0] + box[2] &&
          z + REACH >= box[1] && z - REACH <= box[1] + box[2]
        )
      }
      if (
        fogCells != explored ||
        Math.hypot(f.body.x - fogAt[0], f.body.z - fogAt[1]) >= 2
      ) {
        fogCells = explored
        fogAt = [f.body.x, f.body.z]
        points = [...local, fogAt]
      }
      uncover(points)
      let visible = (x: number, z: number) => revealed([x, z], points)
      let here = f.down ? null : fireNear(f.body.x, f.body.z)
      near = !!here
      known = new Set(visited)
      let destinations = [...visited].filter((id) =>
        id != here?.level && !!villageOf(id)
      ).sort((a, b) => LEVELS[a].name.localeCompare(LEVELS[b].name))
      let choicesHtml = here
        ? `<b>Travel by fire</b><span>Choose a village fire you have found.</span><div class=Map_Fires>${
          destinations.length
            ? destinations.map((id) =>
              `<button class="Btn Btn-small" data-fire="${esc(id)}">${
                esc(LEVELS[id].name)
              }</button>`
            ).join('')
            : '<span>Explore to find another village fire.</span>'
        }</div>`
        : '<span>Stand beside a village fire to travel.</span>'
      if (choicesHtml != choicesWas) {
        choicesWas = choicesHtml
        choices.innerHTML = choicesHtml
      }
      let at = (x: number, z: number) =>
        `left:${pct(x, box[0])};top:${pct(z, box[1])}`
      let fire = villageOf(f.level)
      let html =
        (fire && visible(...fire.at)
          ? `<i class=Map_Fire style="${at(...fire.at)}"${
            tipped({ name: `${LEVELS[f.level].name} fire` })
          }>${glyph('flame')}</i>`
          : '') +
        goals.filter((g) => visible(...g.at)).map((g) =>
          `<i class=Map_Goal style="${at(...g.at)}"${
            tipped({ name: g.title })
          }></i>`
        ).join('') +
        nodes.filter((n) =>
          (!n.prop || n.rarity != 'common') && visible(n.at[0], n.at[2])
        ).map((n) =>
          `<i class="Map_Node Map_Node-${n.lode.trade}${
            n.spent ? ' Map_Node-spent' : ''
          } ${tint(n.rarity)}" style="${at(n.at[0], n.at[2])}"${
            tipped({ name: n.lode.name })
          }></i>`
        ).join('') +
        exits(f.level).filter((r) => visible(...r.at)).map((r) =>
          `<span class="Map_Road Map_Road-${r.side}" style="${at(...r.at)}">${
            esc(LEVELS[r.to]?.name ?? r.to)
          }</span>`
        ).join('') +
        f.givers.filter((g) => visible(g.x, g.z)).map((g) =>
          `<i class="Map_Giver${g.mark ? ' Map_Giver-quest' : ''}" style="${
            at(g.x, g.z)
          }"${tipped({ name: g.name })}>${g.mark}</i>`
        ).join('') +
        f.others.filter((o) => visible(o.body.x, o.body.z)).map((o) =>
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
