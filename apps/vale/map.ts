// A map of the world, north up, filling its panel: it opens near the hero
// and zooms out to a broad view that can pan through explored country. Grown
// chunks are charted once and composited at every scale (mapground.ts). Over
// them, who is where, written only while it is open: the hero's arrow, the
// other players, the people with a quest, the nodes to gather (work.ts),
// coloured by their trade and hollow while spent, where each road leaves the
// map and the region it leads to, and a ring where each quest tracked goes
// next (journal.ts). Its controls stand on top of it. M or the compass opens
// its panel.
import { h, render } from 'preact'
import { Button, Section } from '@yaks/ui'
import { chartVersion, fogged } from './grown.ts'
import { groundImages } from './mapground.ts'
import { glyph } from './glyphs.ts'
import type { Mark } from './journal.ts'
import { levelOf, type Side, SIZE, type Spot } from './levels.ts'
import {
  type Box,
  cover,
  pan,
  pinch,
  reopen,
  under,
  view,
  WORLD,
  zoom,
} from './mapview.ts'
import type { Panel } from './panel.ts'
import type { Frame } from './play.ts'
import { clamp } from './rand.ts'
import { tint } from './rarity.ts'
import { originOf, regionOf } from './regions.ts'
import { hint } from './tile.ts'
import { tipped } from './tip.ts'
import { arriveOf, roadsOf } from './ways.ts'
import type { Seen } from './work.ts'
import { fireNear } from './fires.ts'
import { villageOf } from './terrain.ts'
import { FOG_SIZE } from './mapfog.ts'

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
 * import { seedThemes } from './themes_fixture.ts'
 * seedThemes()
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

/** The map, drawn into its panel (panel.ts): the ground fills it, and where
 * the hero is, the tools and the fires to travel by stand on top. */
export let map = (panel: Panel, travel: (to: string) => void) => {
  panel.body.classList.add('Map_Host')
  // Zoom in or out, back to the hero, or out to the world.
  let tool = (does: string, words: string, label?: string) =>
    h(Button, {
      'data-map': does,
      'aria-label': label,
      onClick: () =>
        setView(
          does == 'here'
            ? view(hero)
            : does == 'world'
            ? view(hero, WORLD[2])
            : zoom(aim, does == 'in' ? 1 / 1.5 : 1.5),
          true,
        ),
    }, words)
  render(
    [
      h(
        'div',
        { class: 'Map' },
        h('canvas', { class: 'Map_Ground' }),
        h('canvas', { class: 'Map_Fog' }),
        h('div', { class: 'Map_Marks' }),
      ),
      h(
        'div',
        { class: 'Map_Where' },
        h('b', { class: 'Map_Land' }),
        h('span', { class: 'Map_Scale' }),
      ),
      h(
        'div',
        { class: 'Map_Tools' },
        tool('in', '+', 'Zoom in'),
        tool('out', '−', 'Zoom out'),
        tool('here', 'Here'),
        tool('world', 'World'),
      ),
      h('div', { class: 'Map_Travel' }),
    ],
    panel.body,
  )
  let stage = panel.body.querySelector<HTMLElement>('.Map')!
  let land = panel.body.querySelector<HTMLElement>('.Map_Land')!
  let scale = panel.body.querySelector<HTMLElement>('.Map_Scale')!
  let canvas = panel.body.querySelector<HTMLCanvasElement>('.Map_Ground')!
  let fog = panel.body.querySelector<HTMLCanvasElement>('.Map_Fog')!
  let marks = panel.body.querySelector<HTMLElement>('.Map_Marks')!
  let choices = panel.body.querySelector<HTMLElement>('.Map_Travel')!
  // Travel by the fire the hero stands beside to one found before.
  let near = false
  let go = (to: string) => {
    if (!near) return
    travel(to)
    panel.close()
  }

  // The view is a square of world metres, which the panel shows across its
  // shorter side. The ground, its veil and the marks are drawn over the
  // square about it that covers the panel (mapview.ts `cover`). The ground
  // may lag a drag or zoom; its last composition is transformed until the
  // next one has been painted.
  let box = view([0, 0], WORLD[2])
  let aim = box
  let frameWas = performance.now()
  let home: Box | null = null
  let drawn = box
  let fogDrawn = box
  let explored = new Set<string>()
  let shown = ''
  let version = chartVersion
  let openWas = false
  let levelWas = ''
  let hero: Spot = [0, 0]
  let was = ''
  let fogWas = ''
  let fogCtx = fog.getContext('2d')!
  let choicesWas = ''
  let wide = 1
  let tall = 1
  let seen = () => cover(box, wide, tall)
  fog.width = fog.height = FOG_SIZE
  let ctx = canvas.getContext('2d')!
  let key = () => seen().join(',')
  let moveImage = (image: HTMLCanvasElement, drawn: Box) => {
    let [x0, z0, side] = seen()
    let x = (drawn[0] - x0) / side * 100
    let z = (drawn[1] - z0) / side * 100
    image.style.transform = `translate(${x}%, ${z}%) scale(${drawn[2] / side})`
  }
  let moveImages = () => {
    moveImage(canvas, drawn)
    moveImage(fog, fogDrawn)
  }
  new ResizeObserver(([{ contentRect }]) => {
    if (!contentRect.width || !contentRect.height) return
    wide = contentRect.width
    tall = contentRect.height
    moveImages()
  }).observe(stage)
  let setView = (next: Box, smooth = false) => {
    if (next.join() == box.join()) next = box
    aim = next
    if (smooth || next == box) return
    box = next
    was = ''
    moveImages()
  }
  let advance = () => {
    let now = performance.now()
    let dt = Math.min(now - frameWas, 64)
    frameWas = now
    if (box == aim) return
    let t = 1 - Math.exp(-dt / 90)
    let next: Box = [
      box[0] + (aim[0] - box[0]) * t,
      box[1] + (aim[1] - box[1]) * t,
      box[2] + (aim[2] - box[2]) * t,
    ]
    if (next.every((n, i) => Math.abs(n - aim[i]) < 0.05)) next = aim
    box = next
    was = ''
    moveImages()
  }
  let draw = () => {
    if (version != chartVersion) {
      version = chartVersion
      shown = ''
    }
    let id = `${key()}/${[...explored].sort().join(',')}`
    if (shown == id) return
    shown = id
    let asked = seen()
    drawn = asked
    // 320 pixels across the view, as many beyond it as the panel shows.
    let px = Math.round(320 * asked[2] / box[2])
    if (canvas.width != px) canvas.width = canvas.height = px
    canvas.style.transform = ''
    ctx.fillStyle = '#22231f'
    ctx.fillRect(0, 0, px, px)
    let askedAt = version
    groundImages(asked, explored).then((charts) => {
      if (askedAt != chartVersion || shown != id) return
      let scale = px / asked[2]
      for (let { image, box: tile } of charts) {
        ctx.drawImage(
          image,
          (tile[0] - asked[0]) * scale,
          (tile[1] - asked[1]) * scale,
          tile[2] * scale,
          tile[2] * scale,
        )
      }
      moveImages()
    }).catch(reportError)
  }
  let uncover = (visited: ReadonlySet<string>) => {
    let id = `${key()}/${[...visited].sort().join(',')}`
    if (id == fogWas) return
    fogWas = id
    let asked = seen()
    fogged(asked, visited).then((px) => {
      if (id == fogWas) {
        fogDrawn = asked
        fogCtx.putImageData(
          new ImageData(px, FOG_SIZE, FOG_SIZE),
          0,
          0,
        )
        moveImages()
      }
    }).catch(reportError)
  }

  // The fraction of the view under a point of the page (mapview.ts `under`).
  let pointed = (x: number, y: number): Spot => {
    let rect = stage.getBoundingClientRect()
    return under([x - rect.left, y - rect.top], rect.width, rect.height)
  }
  stage.addEventListener('wheel', (e) => {
    e.preventDefault()
    let rect = stage.getBoundingClientRect()
    let pixels = e.deltaY *
      (e.deltaMode == 1 ? 40 : e.deltaMode == 2 ? rect.height : 1)
    setView(
      zoom(
        aim,
        Math.exp(clamp(pixels, -240, 240) * 0.0015),
        pointed(e.clientX, e.clientY),
      ),
      true,
    )
  }, { passive: false })
  let drag: { x: number; z: number; box: Box } | null = null
  let points = new Map<number, Spot>()
  let gesture: { from: Spot; span: number; box: Box } | null = null
  let pair = () => {
    let [a, b] = [...points.values()]
    return {
      from: pointed((a[0] + b[0]) / 2, (a[1] + b[1]) / 2),
      span: Math.hypot(a[0] - b[0], a[1] - b[1]),
    }
  }
  stage.addEventListener('pointerdown', (e) => {
    aim = box
    points.set(e.pointerId, [e.clientX, e.clientY])
    if (points.size == 1) drag = { x: e.clientX, z: e.clientY, box }
    if (points.size == 2) {
      drag = null
      gesture = { ...pair(), box }
    }
    stage.setPointerCapture(e.pointerId)
  })
  stage.addEventListener('pointermove', (e) => {
    if (!points.has(e.pointerId)) return
    points.set(e.pointerId, [e.clientX, e.clientY])
    if (gesture && points.size == 2) {
      let now = pair()
      if (now.span && gesture.span) {
        setView(pinch(
          gesture.box,
          gesture.from,
          now.from,
          gesture.span / now.span,
        ))
      }
      return
    }
    if (!drag) return
    let { width, height } = stage.getBoundingClientRect()
    let side = Math.min(width, height)
    setView(
      pan(drag.box, (e.clientX - drag.x) / side, (e.clientY - drag.z) / side),
    )
  })
  let end = (e: PointerEvent) => {
    points.delete(e.pointerId)
    gesture = points.size == 2 ? { ...pair(), box } : null
    let [left] = points.values()
    drag = points.size == 1 ? { x: left[0], z: left[1], box } : null
    if (!left) draw()
  }
  stage.addEventListener('pointerup', end)
  stage.addEventListener('pointercancel', end)
  stage.addEventListener('dblclick', (e) => {
    setView(zoom(aim, 1 / 1.5, pointed(e.clientX, e.clientY)), true)
  })

  return {
    /** mark who is where this frame, the nodes, and where each quest tracked
     * goes next, when the map is open */
    show: (
      f: Frame,
      nodes: Seen[] = [],
      goals: Mark[] = [],
      visited: ReadonlySet<string> = new Set(),
      regions: ReadonlySet<string> = new Set(),
    ) => {
      if (!panel.open) {
        openWas = false
        return
      }
      explored = new Set(regions)
      advance()
      hero = [f.body.x, f.body.z]
      if (!openWas) {
        openWas = true
        home = reopen(hero, home)
        setView(home)
      }
      if (levelWas != f.level) {
        levelWas = f.level
        land.textContent = levelOf(f.level)?.name ?? f.level
      }
      if (!drag && !gesture && box == aim) {
        draw()
        uncover(regions)
      }
      scale.textContent = `${
        Math.round(box[2] * wide / Math.min(wide, tall))
      } m across`
      let [x0, z0, side] = seen()
      let inside = (x: number, z: number) =>
        x >= x0 && x <= x0 + side && z >= z0 && z <= z0 + side
      let visible = (x: number, z: number) =>
        inside(x, z) && regions.has(regionOf(x, z))
      let here = f.down ? null : fireNear(f.body.x, f.body.z)
      near = !!here
      let destinations = here
        ? [...visited].filter((id) => id != here.level && !!villageOf(id))
          .sort((a, b) => levelOf(a)!.name.localeCompare(levelOf(b)!.name))
        : []
      let fires = `${!!here}/${destinations}`
      if (fires != choicesWas) {
        choicesWas = fires
        render(
          here
            ? h(
              Section,
              {},
              h(Section.Title, {}, 'Travel by fire'),
              h(Section.Sub, {}, 'Choose a village fire you have found.'),
              destinations.length
                ? h(
                  'div',
                  { class: 'Map_Fires' },
                  destinations.map((id) =>
                    h(Button, {
                      key: id,
                      'data-fire': id,
                      onClick: () => go(id),
                    }, levelOf(id)!.name)
                  ),
                )
                : hint('Explore to find another village fire.'),
            )
            : hint('Stand beside a village fire to travel.'),
          choices,
        )
      }
      // Where a point sits on the map, as a percentage across and down.
      let pct = (m: number) => `${(m / side * 100).toFixed(2)}%`
      let at = (x: number, z: number) =>
        `left:${pct(x - x0)};top:${pct(z - z0)}`
      let html = [...new Set([f.level, ...visited])].flatMap((id) => {
        let fire = villageOf(id)
        return fire && visible(...fire.at)
          ? [
            `<i class=Map_Fire style="${at(...fire.at)}"${
              tipped({ name: `${levelOf(id)!.name} fire` })
            }>${glyph('flame')}</i>`,
          ]
          : []
      }).join('') +
        (box[2] > 320
          ? [...regions].map((id) => ({
            id,
            at: originOf(id).map((m) => m + SIZE / 2) as Spot,
          })).filter(({ at: p }) => visible(...p)).map(({ id, at: p }) =>
            `<span class=Map_Region style="${at(...p)}"${
              tipped({ name: levelOf(id)!.name })
            }>${esc(levelOf(id)!.name)}</span>`
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
            tipped({ name: n.name })
          }></i>`
        ).join('') +
        (box[2] == 320 ? exits(f.level) : []).filter((r) => visible(...r.at))
          .map((r) =>
            `<span class="Map_Road Map_Road-${r.side}" style="${at(...r.at)}">${
              esc(levelOf(r.to)?.name ?? r.to)
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
