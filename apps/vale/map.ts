// A map of the world, north up: it opens near the hero and zooms out to all
// its lands. Nearby ground is charted off the page's thread (chart.ts); at
// world scale, the land palette gives an immediate overview. Over it,
// who is where, written only while it is open: the hero's arrow, the other
// players, the people with a quest, the nodes to gather (work.ts), coloured
// by their trade and hollow while spent, where each road leaves the map and
// the region it leads to, and a ring where each quest tracked goes next
// (journal.ts). M or the compass opens its panel.
import { charted } from './grown.ts'
import { Top } from './features.ts'
import { glyph } from './glyphs.ts'
import { paletteOf } from './ground.ts'
import type { Mark } from './journal.ts'
import { LEVELS, type Side, SIZE, type Spot } from './levels.ts'
import { type Box, pan, place, view, WORLD, zoom } from './mapview.ts'
import type { Panel } from './panel.ts'
import type { Frame } from './play.ts'
import { clamp } from './rand.ts'
import { tint } from './rarity.ts'
import { originOf, regionOf } from './regions.ts'
import { tipped } from './tip.ts'
import { arriveOf, roadsOf } from './ways.ts'
import type { Seen } from './work.ts'
import { fireNear } from './fires.ts'
import { villageOf } from './terrain.ts'
import { mapped, REACH, revealed } from './explore.ts'

// How far past a region's cell road exits are marked, in metres.
let MARGIN = 32

let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

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
    `<div class=Map_Wrap><div class=Map_Tools><button class="Btn Btn-small" data-map=here>Here</button><span class=Map_Scale></span><button class="Btn Btn-small" data-map=in aria-label="Zoom in">+</button><button class="Btn Btn-small" data-map=out aria-label="Zoom out">−</button><button class="Btn Btn-small" data-map=world>World</button></div><div class=Map><canvas class=Map_Ground></canvas><canvas class=Map_Fog></canvas><div class=Map_Marks></div></div><div class=Map_Travel></div></div>`
  let stage = panel.body.querySelector<HTMLElement>('.Map')!
  let tools = panel.body.querySelector<HTMLElement>('.Map_Tools')!
  let scale = panel.body.querySelector<HTMLElement>('.Map_Scale')!
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

  // The view is a square of world metres. The ground may lag a drag or zoom;
  // its last chart is transformed until the next one has been painted.
  let box = WORLD
  let drawn = box
  let shown = ''
  let openWas = false
  let levelWas = ''
  let hero: Spot = [0, 0]
  let cache = new Map<string, ImageData>()
  let was = ''
  let fogWas: ReadonlyArray<Spot> | null = null
  let local: Spot[] = []
  let localWas: ReadonlyArray<Spot> | null = null
  let boxWas = ''
  let labels: { id: string; at: Spot }[] = []
  let labelsWas: ReadonlyArray<Spot> | null = null
  let choicesWas = ''
  let pending: number | undefined
  canvas.width = canvas.height = 320
  fog.width = fog.height = 320
  let ctx = canvas.getContext('2d')!
  let key = () => box.join(',')
  let moveGround = () => {
    let x = (drawn[0] - box[0]) / box[2] * 100
    let z = (drawn[1] - box[1]) / box[2] * 100
    canvas.style.transform = `translate(${x}%, ${z}%) scale(${
      drawn[2] / box[2]
    })`
  }
  let setView = (next: Box) => {
    if (next.join() == box.join()) return
    box = next
    boxWas = ''
    was = ''
    fogWas = null
    moveGround()
  }
  let overview = () => {
    ctx.fillStyle = '#30382d'
    ctx.fillRect(0, 0, 320, 320)
    for (let lv of Object.values(LEVELS)) {
      let [ox, oz] = originOf(lv.id)
      let [u, v] = place(box, [ox, oz])
      let side = SIZE / box[2] * 320
      if (u > 1 || v > 1 || u + side / 320 < 0 || v + side / 320 < 0) {
        continue
      }
      let colors = paletteOf(lv).tops
      let color = Object.values(lv.look?.ground ?? {})[0] ?? colors[Top.grass]
      ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`
      ctx.fillRect(u * 320, v * 320, side, side)
      ctx.strokeStyle = 'rgba(35, 40, 32, 0.3)'
      ctx.strokeRect(u * 320, v * 320, side, side)
    }
    let roads = new Set<string>()
    ctx.strokeStyle = '#c1a371'
    ctx.lineWidth = box[2] == WORLD[2] ? 1.5 : 2
    for (let lv of Object.values(LEVELS)) {
      for (let r of roadsOf(lv.id)) {
        let id = `${r.from}/${r.to}`
        if (roads.has(id)) continue
        roads.add(id)
        let path: Spot[] = [
          arriveOf(r.from),
          ...Array.from(r.c.xs, (x, i): Spot => [x, r.c.zs[i]]),
          arriveOf(r.to),
        ]
        ctx.beginPath()
        for (let [i, p] of path.entries()) {
          let [u, v] = place(box, p)
          if (i) ctx.lineTo(u * 320, v * 320)
          else ctx.moveTo(u * 320, v * 320)
        }
        ctx.stroke()
      }
    }
  }
  let draw = () => {
    let id = key()
    if (shown == id) return
    shown = id
    drawn = box
    canvas.style.transform = ''
    let image = cache.get(id)
    if (image) {
      ctx.putImageData(image, 0, 0)
      return
    }
    overview()
    // The 2,560 m chart takes seconds even off-thread. At world scale, the
    // overview is the useful detail: discovered places and the roads to them.
    if (box[2] == WORLD[2]) return
    let m = box[2] / 320
    charted(...box, m).then((px) => {
      let image = new ImageData(px, 320, 320)
      cache.set(id, image)
      if (cache.size > 8) cache.delete(cache.keys().next().value!)
      if (shown != id) return
      ctx.putImageData(image, 0, 0)
      moveGround()
    }).catch(reportError)
  }
  // Where a point sits on the map, as a percentage across and down.
  let pct = (m: number, from: number) =>
    `${((m - from) / box[2] * 100).toFixed(2)}%`
  let uncover = (points: ReadonlyArray<Spot>) => {
    if (points == fogWas) return
    fogWas = points
    let ctx = fog.getContext('2d')!
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#22231f'
    ctx.fillRect(0, 0, fog.width, fog.height)
    ctx.globalCompositeOperation = 'destination-out'
    for (let [x, z] of points) {
      let m = box[2] / 320
      let cx = (x - box[0]) / m, cz = (z - box[1]) / m
      let r = REACH / m
      if (
        cx + r < 0 || cz + r < 0 || cx - r > fog.width ||
        cz - r > fog.height
      ) continue
      let shade = ctx.createRadialGradient(
        cx,
        cz,
        Math.max(0, r - 5 / m),
        cx,
        cz,
        r,
      )
      shade.addColorStop(0, '#000')
      shade.addColorStop(1, 'transparent')
      ctx.fillStyle = shade
      ctx.beginPath()
      ctx.arc(cx, cz, r, 0, 2 * Math.PI)
      ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  tools.addEventListener('click', (e) => {
    let action = e.target instanceof Element
      ? e.target.closest<HTMLElement>('[data-map]')?.dataset.map
      : undefined
    if (!action) return
    setView(
      action == 'here'
        ? view(hero)
        : action == 'world'
        ? WORLD
        : zoom(box, action == 'in' ? -1 : 1),
    )
    draw()
  })
  stage.addEventListener('wheel', (e) => {
    e.preventDefault()
    let rect = stage.getBoundingClientRect()
    setView(zoom(box, e.deltaY < 0 ? -1 : 1, [
      (e.clientX - rect.left) / rect.width,
      (e.clientY - rect.top) / rect.height,
    ]))
    clearTimeout(pending)
    pending = setTimeout(() => {
      pending = undefined
      if (panel.open) draw()
    }, 120)
  }, { passive: false })
  let drag: { x: number; z: number; box: Box } | null = null
  stage.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, z: e.clientY, box }
    stage.setPointerCapture(e.pointerId)
  })
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return
    let side = stage.getBoundingClientRect().width
    setView(
      pan(drag.box, (e.clientX - drag.x) / side, (e.clientY - drag.z) / side),
    )
  })
  stage.addEventListener('pointerup', () => {
    drag = null
    draw()
  })
  stage.addEventListener('pointercancel', () => {
    drag = null
    draw()
  })
  stage.addEventListener('dblclick', (e) => {
    let rect = stage.getBoundingClientRect()
    setView(zoom(box, -1, [
      (e.clientX - rect.left) / rect.width,
      (e.clientY - rect.top) / rect.height,
    ]))
    draw()
  })

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
      if (!panel.open) {
        openWas = false
        return
      }
      hero = [f.body.x, f.body.z]
      if (!openWas || levelWas != f.level) {
        openWas = true
        levelWas = f.level
        setView(view(hero))
        panel.head(esc(LEVELS[f.level]?.name ?? f.level))
      }
      if (!drag && pending == undefined) draw()
      scale.textContent = box[2] == WORLD[2]
        ? 'Whole world'
        : `${box[2]} m across`
      if (localWas != explored || boxWas != key()) {
        localWas = explored
        boxWas = key()
        local = mapped(explored, box)
      }
      uncover(local)
      let inside = (x: number, z: number) =>
        x >= box[0] && x <= box[0] + box[2] &&
        z >= box[1] && z <= box[1] + box[2]
      let visible = (x: number, z: number) =>
        inside(x, z) && revealed([x, z], local)
      if (box[2] > 320 && labelsWas != explored) {
        labelsWas = explored
        let closest = new Map<string, { at: Spot; d: number }>()
        for (let p of explored) {
          let id = regionOf(...p)
          let [ox, oz] = originOf(id)
          let d = Math.hypot(p[0] - ox - SIZE / 2, p[1] - oz - SIZE / 2)
          if (d < (closest.get(id)?.d ?? Infinity)) {
            closest.set(id, { at: p, d })
          }
        }
        labels = [...closest].map(([id, { at }]) => ({ id, at }))
      }
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
      let html = [...new Set([f.level, ...visited])].flatMap((id) => {
        let fire = villageOf(id)
        return fire && visible(...fire.at)
          ? [
            `<i class=Map_Fire style="${at(...fire.at)}"${
              tipped({ name: `${LEVELS[id].name} fire` })
            }>${glyph('flame')}</i>`,
          ]
          : []
      }).join('') +
        (box[2] > 320
          ? labels.filter(({ at: p }) => visible(...p)).map(({ id, at: p }) =>
            `<span class=Map_Region style="${at(...p)}"${
              tipped({ name: LEVELS[id].name })
            }>${esc(LEVELS[id].name)}</span>`
          ).join('')
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
        (box[2] == 320 ? exits(f.level) : []).filter((r) => visible(...r.at))
          .map((r) =>
            `<span class="Map_Road Map_Road-${r.side}" style="${at(...r.at)}">${
              esc(LEVELS[r.to]?.name ?? r.to)
            }</span>`
          ).join('') +
        f.givers.filter((g) => box[2] <= 640 && visible(g.x, g.z)).map((g) =>
          `<i class="Map_Giver${g.mark ? ' Map_Giver-quest' : ''}" style="${
            at(g.x, g.z)
          }"${tipped({ name: g.name })}>${g.mark}</i>`
        ).join('') +
        f.others.filter((o) =>
          box[2] <= 640 &&
          visible(o.body.x, o.body.z)
        ).map((o) =>
          `<i class=Map_Other style="${at(o.body.x, o.body.z)}"${
            tipped({ name: o.name })
          }></i>`
        ).join('') +
        // The hero's arrow points the way they face: (sin yaw, cos yaw) on
        // the ground, which is π − yaw clockwise from north.
        (inside(f.body.x, f.body.z)
          ? `<i class=Map_Me style="${at(f.body.x, f.body.z)};--turn:${
            Math.round((Math.PI - f.body.yaw) * 180 / Math.PI)
          }deg"></i>`
          : '')
      if (html == was) return
      was = html
      marks.innerHTML = html
    },
  }
}
