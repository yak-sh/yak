// Where each entity of a selection sits, and the lines between them. Pure:
// bundles in, positions out. A drawing that has been seen keeps its places,
// and a newcomer goes where it overlaps nothing, crosses few lines and sits a
// short reach from what it names, the way a person adds to a sketch.
import type { Bundle } from '@yaks/graph'

/** An entity drawn as a box. */
export type Node = {
  eid: string
  /** The short id a person reads: a human id, or the eid's handle. */
  label: string
  /** What the entity says it is, cut to fit the box. */
  title: string
  /** Its components, without the bookkeeping ones (`quiet`). */
  comps: string[]
  /** When it joined the drawing: 0 for the first entity ever drawn. */
  order: number
  x: number
  y: number
  /** Joined the drawing in this layout. */
  fresh: boolean
}

/** A line between two drawn entities: an `edge{from, to}` entity, named by
 * its other components, or a property holding the other's eid, named
 * `comp.prop`. */
export type Link = {
  key: string
  from: string
  to: string
  name: string
  /** The edge entity, for a line that is one. */
  eid?: string
  order: number
  fresh: boolean
}

/** A drawing's sheet, entities and lines. */
export type Layout = {
  width: number
  height: number
  nodes: Node[]
  links: Link[]
}

/** How a selection is laid out. */
export type Options = {
  /** The previous layout: its entities keep their places. */
  was?: Layout
  /** The sheet's size; it grows downward when the entities need room. */
  width?: number
  height?: number
  /** The short id of a bundle (default: its eid's handle, `#a3f19c024b`). */
  label?: (bundle: Bundle) => string
  /** Components left off a node's list (default: entity, created, updated). */
  quiet?: readonly string[]
}

/** A node's half width and half height. */
export const BOX = { w: 76, h: 26 }
const GAP = 14
const REACH = 190
const QUIET = ['entity', 'created', 'updated']
// A line drawn from bookkeeping would join everything to its writer.
const SILENT = new Set(['entity', 'updated', 'tombstone'])

/** `#` and the eid's first ten hex digits, the handle @yaks/id shows. */
export let handle = (eid: string): string =>
  '#' + eid.replaceAll('-', '').slice(0, 10).toLowerCase()

/** A line of at most n characters, ending in an ellipsis when cut. */
export let cut = (text: string, n: number): string =>
  text.length > n ? text.slice(0, n - 1).trimEnd() + '…' : text

let words = (b: Bundle, quiet: readonly string[]) =>
  Object.keys(b).filter((k) => !k.startsWith('$') && !quiet.includes(k))

let titled = (b: Bundle): string => {
  let doc = b.doc as { title?: unknown; body?: unknown } | undefined
  let file = b.file as { path?: unknown } | undefined
  let text = [doc?.title, doc?.body, file?.path]
    .find((t) => typeof t == 'string' && t.trim())
  return typeof text == 'string' ? cut(text.trim().split('\n')[0], 22) : ''
}

let isEdge = (b: Bundle) => {
  let e = b.edge as { from?: unknown; to?: unknown } | undefined
  return typeof e?.from == 'string' && typeof e?.to == 'string'
}

type Line = Omit<Link, 'order' | 'fresh'>

/** The lines a selection draws: each edge entity, and every property that
 * names another selected entity. A line to an entity outside the selection is
 * not drawn. */
export let links = (bundles: Bundle[]): Line[] => {
  let here = new Set(
    bundles.filter((b) => !isEdge(b)).map((b) => b.entity.eid),
  )
  let out = new Map<string, Line>()
  let add = (l: Omit<Line, 'key'>) => {
    if (l.from == l.to || !here.has(l.from) || !here.has(l.to)) return
    let key = `${l.from}>${l.name}>${l.to}`
    if (!out.has(key)) out.set(key, { key, ...l })
  }
  for (let b of bundles) {
    if (isEdge(b)) {
      let { from, to } = b.edge as { from: string; to: string }
      let name = words(b, [...QUIET, 'edge']).join(' ') || 'edge'
      add({ from, to, name, eid: b.entity.eid })
      continue
    }
    for (let [comp, value] of Object.entries(b)) {
      if (comp.startsWith('$') || SILENT.has(comp)) continue
      if (!value || typeof value != 'object') continue
      for (let [prop, v] of Object.entries(value as Record<string, unknown>)) {
        if (prop == 'via') continue
        for (let to of Array.isArray(v) ? v : [v]) {
          if (typeof to == 'string') {
            add({ from: b.entity.eid, to, name: `${comp}.${prop}` })
          }
        }
      }
    }
  }
  return [...out.values()]
}

type Spot = [number, number]

// Whether the segment a–b passes through a box centred at p.
let crosses = ([x, y]: Spot, [ax, ay]: Spot, [bx, by]: Spot) => {
  let dx = bx - ax, dy = by - ay
  let t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)
  t = Math.max(0, Math.min(1, t))
  return Math.abs(ax + dx * t - x) < BOX.w + 6 &&
    Math.abs(ay + dy * t - y) < BOX.h + 6
}

// The boxes already placed, filed by band so a spot is checked only against
// its neighbours.
const BAND = 2 * BOX.h + GAP
let bands = () => {
  let rows = new Map<number, Spot[]>()
  let band = (y: number) => Math.floor(y / BAND)
  return {
    /** Every row above this is full. */
    full: 0,
    add: (p: Spot) => {
      let k = band(p[1])
      rows.set(k, [...rows.get(k) ?? [], p])
    },
    // How much of a box at p would cover the boxes already placed.
    covered: ([x, y]: Spot) => {
      let c = 0
      for (let k = band(y) - 1; k <= band(y) + 1; k++) {
        for (let [bx, by] of rows.get(k) ?? []) {
          let ox = 2 * BOX.w + GAP - Math.abs(x - bx)
          let oy = 2 * BOX.h + GAP - Math.abs(y - by)
          if (ox > 0 && oy > 0) c += 1e5 + ox * oy
        }
      }
      return c
    },
  }
}

type Sheet = {
  boxes: ReturnType<typeof bands>
  lines: [Spot, Spot][]
  reach: Spot[]
  width: number
  height: number
}

// The cost of a node at p: overlapping a box is never worth it, crossing a
// line is worth avoiding, and each named neighbour should be about REACH
// away. With no neighbour drawn it settles near the top middle, and below the
// sheet's bottom it costs a little more, so the sheet grows only when full.
let cost = ([x, y]: Spot, s: Sheet) => {
  let c = s.boxes.covered([x, y])
  if (c) return c
  if (!s.reach.length) c += Math.hypot(x - s.width / 2, (y - BOX.h) * 1.6) * .15
  if (y > s.height - BOX.h - GAP) c += 40
  for (let [a, b] of s.lines) if (crosses([x, y], a, b)) c += 400
  for (let [nx, ny] of s.reach) {
    c += Math.abs(Math.hypot(x - nx, y - ny) - REACH) * 1.5
  }
  return c
}

// The spot a newcomer takes: the cheapest within a reach of its neighbours
// (or of the top middle), or else the first free one, from the top down and
// nearest that middle across.
let place = (s: Sheet): Spot => {
  let left = BOX.w + GAP, right = s.width - BOX.w - GAP, top = BOX.h + GAP
  let [ax, ay] = s.reach.length
    ? s.reach.reduce(
      ([x, y], [a, b]) => [x + a / s.reach.length, y + b / s.reach.length],
      [0, 0],
    )
    : [s.width / 2, top]
  let r = REACH + BOX.w
  let x0 = Math.max(left, ax - r), x1 = Math.min(right, ax + r)
  let y0 = Math.max(top, ay - r), y1 = ay + r
  // Only a line whose box meets the window can cross a spot in it.
  let local = s.lines.filter(([[px, py], [qx, qy]]) =>
    Math.max(px, qx) > x0 - BOX.w && Math.min(px, qx) < x1 + BOX.w &&
    Math.max(py, qy) > y0 - BOX.h && Math.min(py, qy) < y1 + BOX.h
  )
  let near = { ...s, lines: local }
  let best: [number, number, number] = [Infinity, ax, ay]
  for (let x = x0; x <= x1; x += BOX.w / 2) {
    for (let y = y0; y <= y1; y += BOX.h) {
      let c = cost([x, y], near)
      if (c < best[0]) best = [c, x, y]
    }
  }
  if (best[0] < 1e5) return [best[1], best[2]]
  let across: number[] = []
  for (let x = left; x <= right; x += BOX.w / 2) across.push(x)
  across.sort((a, b) => Math.abs(a - ax) - Math.abs(b - ax))
  // Boxes are only ever added, so a row found full stays full.
  for (let y = Math.max(top, s.boxes.full);; y += BOX.h, s.boxes.full = y) {
    for (let x of across) if (!s.boxes.covered([x, y])) return [x, y]
  }
}

/**
 * Lay out a selection. Entities in `was` keep their places and order; each new
 * one, in the order given, takes the cheapest free spot. The sheet grows
 * downward when nothing on it is free.
 *
 * ```ts
 * import { layout } from '@yaks/diagram'
 * import { equal } from '@yaks/testing'
 *
 * let a = { entity: { eid: '0a' }, doc: { title: 'Buy the cake' } }
 * let b = { entity: { eid: '0b' }, comment: { target: '0a' } }
 * let drawn = layout([a, b])
 * equal(drawn.links.map((l) => l.name), ['comment.target'])
 * equal(layout([a, b], { was: drawn }).nodes[0].x, drawn.nodes[0].x)
 * ```
 */
export let layout = (bundles: Bundle[], opts: Options = {}): Layout => {
  let { was, label = (b) => handle(b.entity.eid), quiet = QUIET } = opts
  let width = opts.width ?? was?.width ?? 640
  let height = opts.height ?? was?.height ?? 480
  let old = new Map(was?.nodes.map((n) => [n.eid, n]))
  let oldLinks = new Map(was?.links.map((l) => [l.key, l]))
  let drawn = bundles.filter((b) => !isEdge(b))
  let lines = links(bundles)
  let spot = new Map<string, Spot>()
  let boxes = bands()
  let put = (eid: string, p: Spot) => (spot.set(eid, p), boxes.add(p))
  for (let b of drawn) {
    let o = old.get(b.entity.eid)
    if (o) put(o.eid, [o.x, o.y])
  }
  let ends = (l: Line) => [spot.get(l.from), spot.get(l.to)]
  for (let b of drawn) {
    let eid = b.entity.eid
    if (spot.has(eid)) continue
    let reach = lines.flatMap((l): Spot[] => {
      let other = l.from == eid ? l.to : l.to == eid ? l.from : undefined
      let at = other && spot.get(other)
      return at ? [at] : []
    })
    let placed = lines.flatMap((l): [Spot, Spot][] => {
      let [a, z] = ends(l)
      return a && z ? [[a, z]] : []
    })
    put(eid, place({ boxes, lines: placed, reach, width, height }))
  }
  let next = Math.max(-1, ...(was?.nodes ?? []).map((n) => n.order)) + 1
  let nodes = drawn.map((b): Node => {
    let eid = b.entity.eid, o = old.get(eid), [x, y] = spot.get(eid)!
    return {
      eid,
      label: label(b),
      title: titled(b),
      comps: words(b, quiet),
      order: o?.order ?? next++,
      x,
      y,
      fresh: !o,
    }
  })
  let after = Math.max(-1, ...(was?.links ?? []).map((l) => l.order)) + 1
  return {
    width,
    height: Math.max(height, ...nodes.map((n) => n.y + BOX.h + GAP)),
    nodes,
    links: lines.map((l) => {
      let o = oldLinks.get(l.key)
      return { ...l, order: o?.order ?? after++, fresh: !o }
    }),
  }
}
