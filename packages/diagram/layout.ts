// Where each entity of a selection sits, and the lines between them. Pure:
// bundles in, positions out. A drawing that has been seen keeps its places,
// and a newcomer goes where it overlaps nothing, crosses few lines and sits a
// short reach from what it names, the way a person adds to a sketch.
import type { Bundle } from '@yaks/graph'
import { cross, meets, type Spot } from './geometry.ts'
import {
  type Curve,
  curve,
  half,
  on,
  type Seat,
  type Shape,
  SHAPES,
  type Tag,
  tag,
} from './shape.ts'

/** An entity drawn as a shape. */
export type Node = {
  eid: string
  /** The short id a person reads: a human id, or the eid's handle. */
  label: string
  /** What the entity says it is (the drawing cuts it to fit). */
  title: string
  /** Its components, without the bookkeeping ones (`quiet`). */
  comps: string[]
  /** Its outline (`shapes`). */
  shape: Shape
  /** A `status` one of its components carries, such as a task's. */
  state?: string
  /** When it joined the drawing: 0 for the first entity ever drawn. */
  order: number
  /** The stage of the story it joined in (`Options.stage`). */
  stage: number
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
  /** The edge entity, and its short id, for a line that is one. */
  eid?: string
  label?: string
  /** How far aside its middle bends, to keep clear of other shapes and
   * lines: to the left going from `from` to `to`, or the right when
   * negative. */
  bend: number
  /** How far along its curve its name is written, 0 to 1, clear of shapes
   * and other names. */
  mid: number
  order: number
  stage: number
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
  /** The shape each component draws its entity as (default `SHAPES`). */
  shapes?: Record<string, Shape>
  /** Where a newcomer goes, as fractions of the sheet's width and height,
   * when its place is known beforehand; any other takes the cheapest spot. */
  at?: (
    node: { eid: string; label: string; bundle: Bundle },
  ) => [number, number] | undefined
  /** The stage what joins now is stamped with (default 0), so a page can draw
   * each stage in as its reader reaches it. */
  stage?: number
}

/** The room kept clear between two shapes. */
export const APART = 24
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
  return typeof text == 'string' ? cut(text.trim().split('\n')[0], 60) : ''
}

let stateOf = (b: Bundle): string | undefined => {
  for (let v of Object.values(b)) {
    let status = (v as { status?: unknown } | null)?.status
    if (typeof status == 'string') return status
  }
}

let isEdge = (b: Bundle) => {
  let e = b.edge as { from?: unknown; to?: unknown } | undefined
  return typeof e?.from == 'string' && typeof e?.to == 'string'
}

type Line = Omit<
  Link,
  'order' | 'fresh' | 'stage' | 'label' | 'bend' | 'mid'
>

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

/** A placed shape: its centre and half size. */
type Placed = [number, number, number, number]
/** A placed line, as the points it is drawn through, and their bounds. */
type Route = {
  from: string
  to: string
  pts: Spot[]
  box: [number, number, number, number]
}
/** A placed neighbour of a newcomer: its entity, centre and half size. */
type Near = { eid: string; at: Spot; w: number; h: number }

// How far a shape of half size w, h reaches from its centre toward (dx, dy).
let out = (w: number, h: number, dx: number, dy: number) => {
  let l = Math.hypot(dx, dy) || 1
  return Math.min(
    w / (Math.abs(dx) / l || 1e-9),
    h / (Math.abs(dy) / l || 1e-9),
  )
}

// Whether two boxes [x0, y0, x1, y1] overlap.
let over = (a: Route['box'], b: Route['box']) =>
  a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]

// Whether the segment a–b crosses any stretch of a route, checked stretch by
// stretch only when their bounds meet.
let crossing = ([ax, ay]: Spot, [bx, by]: Spot, r: Route) => {
  let x0 = Math.min(ax, bx), x1 = Math.max(ax, bx)
  let y0 = Math.min(ay, by), y1 = Math.max(ay, by)
  let [rx0, ry0, rx1, ry1] = r.box
  if (x1 < rx0 || x0 > rx1 || y1 < ry0 || y0 > ry1) return false
  let { pts } = r
  for (let i = 1; i < pts.length; i++) {
    let [px, py] = pts[i - 1], [qx, qy] = pts[i]
    if (Math.max(px, qx) < x0 || Math.min(px, qx) > x1) continue
    if (Math.max(py, qy) < y0 || Math.min(py, qy) > y1) continue
    if (cross([ax, ay], [bx, by], pts[i - 1], pts[i])) return true
  }
  return false
}

// The shapes already placed, filed by band so a spot is checked only against
// its neighbours. A band is taller than any shape, so a shape can only meet
// those of its own band and the two beside it.
const BAND = 2 * 44 + APART
let bands = () => {
  let rows = new Map<number, Placed[]>()
  let band = (y: number) => Math.floor(y / BAND)
  return {
    /** Every row above this is full. */
    full: 0,
    add: (p: Placed) => {
      let k = band(p[1])
      rows.set(k, [...rows.get(k) ?? [], p])
    },
    // How much a shape of half size w, h at p would cover those placed, with
    // the room kept between two shapes.
    covered: ([x, y]: Spot, w: number, h: number) => {
      let c = 0
      for (let k = band(y) - 1; k <= band(y) + 1; k++) {
        for (let [bx, by, bw, bh] of rows.get(k) ?? []) {
          let ox = w + bw + APART - Math.abs(x - bx)
          let oy = h + bh + APART - Math.abs(y - by)
          if (ox > 0 && oy > 0) c += 1e5 + ox * oy
        }
      }
      return c
    },
  }
}

type Sheet = {
  boxes: ReturnType<typeof bands>
  /** The shapes and lines near enough to matter. */
  shapes: (Placed & { eid: string })[]
  routes: Route[]
  /** The placed entities the newcomer names or is named by, once a line. */
  reach: Near[]
  width: number
  height: number
  /** The newcomer's half size. */
  w: number
  h: number
  /** For an actor, the x of the side of the sheet it keeps to. */
  side?: number
  /** What its lines cost, drawn as they would be from p. */
  lines: (p: Spot) => number
}

// What makes a drawing hard to read costs about as much as a line twice too
// long: a line through a shape, two lines crossing, and two lines from the
// same shape at nearly the same angle, running over each other.
const THROUGH = 1500, CROSS = 700, OVER = 700
// A line is best about LINK long between the shapes' rims, never shorter than
// SHORT, which leaves room for its name, and a shape is better with ROOMY
// around it, so a drawing spreads over its sheet.
const LINK = 110, SHORT = 70, ROOMY = 70
// The sheet's middle pulls a little, so a drawing gathers there, and an
// actor keeps to its side. A spot from which a placed shape cannot be reached
// without crossing a line or a shape costs VIS for each, so what is placed
// stays open to the lines still to come.
const PULL = .4, VIS = 600
// The room kept between a shape and the edge of the sheet, for the lines
// that bend around it.
const EDGE = 24

// The cost of a newcomer at p. Overlapping a shape is never worth it, and below the sheet's bottom it costs more, so the sheet grows
// only when full. Its lines are reckoned straight, as most are drawn.
let cost = (p: Spot, s: Sheet) => {
  let [x, y] = p
  let c = s.boxes.covered(p, s.w, s.h)
  if (c) return c
  if (y > s.height - s.h - 8) c += 400 + (y - s.height + s.h)
  let mine: Route['box'] = [x - s.w - 6, y - s.h - 6, x + s.w + 6, y + s.h + 6]
  for (let r of s.routes) {
    if (!over(r.box, mine)) continue
    if (
      r.pts.some((q, i) => i > 0 && meets(r.pts[i - 1], q, p, s.w + 6, s.h + 6))
    ) {
      c += THROUGH
    }
  }
  for (let n of s.reach) {
    let [nx, ny] = n.at, dx = nx - x, dy = ny - y
    let len = Math.hypot(dx, dy) - out(s.w, s.h, dx, dy) -
      out(n.w, n.h, dx, dy)
    c += Math.abs(len - LINK) * 1.5 + Math.max(0, SHORT - len) * 20
    for (let r of s.routes) {
      if (r.from != n.eid && r.to != n.eid) {
        if (crossing(p, n.at, r)) c += CROSS
        continue
      }
      // Where a line from the same neighbour heads as it leaves it.
      let [ox, oy] = r.from == n.eid ? r.pts[2] : r.pts[r.pts.length - 3]
      let ux = ox - nx, uy = oy - ny
      let cos = (-dx * ux - dy * uy) /
        (Math.hypot(dx, dy) * Math.hypot(ux, uy) || 1)
      if (cos > .96) c += OVER
    }
    for (let o of s.shapes) {
      if (o.eid != n.eid && meets(p, n.at, [o[0], o[1]], o[2] + 6, o[3] + 6)) {
        c += THROUGH
      }
    }
  }
  for (let [ox, oy, ow, oh] of s.shapes) {
    let gap = Math.max(
      Math.abs(x - ox) - s.w - ow,
      Math.abs(y - oy) - s.h - oh,
    )
    if (gap < ROOMY) c += (ROOMY - gap) * 2
  }
  return c +
    (s.side == null
      ? Math.abs(x - s.width / 2) * PULL
      : Math.abs(x - s.side) * 4) +
    Math.abs(y - s.height / 2) * PULL / 2
}

// What a spot costs for the placed shapes it cannot reach in a straight line.
let blind = ([x, y]: Spot, s: Sheet) => {
  let c = 0
  for (let o of s.shapes) {
    if (s.reach.some((n) => n.eid == o.eid)) continue
    let [ox, oy] = o
    let x0 = Math.min(x, ox), x1 = Math.max(x, ox)
    let y0 = Math.min(y, oy), y1 = Math.max(y, oy)
    let hidden = s.routes.some((r) =>
      r.from != o.eid && r.to != o.eid && crossing([x, y], [ox, oy], r)
    ) || s.shapes.some(([qx, qy, qw, qh], i) =>
      s.shapes[i] != o &&
      qx + qw + 16 > x0 && qx - qw - 16 < x1 &&
      qy + qh + 16 > y0 && qy - qh - 16 < y1 &&
      meets([x, y], [ox, oy], [qx, qy], qw + 16, qh + 16)
    )
    if (hidden) {
      c += VIS
    }
  }
  return c
}

// The spot a newcomer takes: the cheapest within a reach of its neighbours
// (or of the sheet's middle), or else the first free one, from the top down
// and nearest that middle across.
let place = (s: Sheet): Spot => {
  let left = s.w + EDGE, right = s.width - s.w - EDGE, top = s.h + EDGE
  let n = s.reach.length
  let [ax, ay] = n
    ? s.reach.reduce(
      ([x, y], { at: [a, b] }) => [x + a / n, y + b / n],
      [0, 0],
    )
    : [s.width / 2, s.height / 2]
  let r = LINK + 3 * s.w + 60
  let x0 = Math.max(left, ax - r), x1 = Math.min(right, ax + r)
  let y0 = Math.max(top, ay - r), y1 = Math.max(y0, ay + r)
  // Only what meets the window, or the lines to it, matters to a spot in it.
  let xs = s.reach.map((n) => n.at[0]), ys = s.reach.map((n) => n.at[1])
  let win: Route['box'] = [
    Math.min(x0, ...xs) - s.w - ROOMY,
    Math.min(y0, ...ys) - s.h - ROOMY,
    Math.max(x1, ...xs) + s.w + ROOMY,
    Math.max(y1, ...ys) + s.h + ROOMY,
  ]
  let near = {
    ...s,
    routes: s.routes.filter((r) => over(r.box, win)),
    shapes: s.shapes.filter(([x, y, w, h]) =>
      over([x - w, y - h, x + w, y + h], win)
    ),
  }
  // A coarse pass over the window, coarser among more shapes; the spots it
  // finds nearly as good as its best, weighed for what they cannot reach; and
  // a fine pass around the best few of those.
  let spots: [number, number, number][] = []
  let scan = (
    xa: number,
    xb: number,
    ya: number,
    yb: number,
    dx: number,
    dy: number,
  ) => {
    for (let x = Math.max(x0, xa); x <= Math.min(x1, xb); x += dx) {
      for (let y = Math.max(y0, ya); y <= Math.min(y1, yb); y += dy) {
        spots.push([cost([x, y], near), x, y])
      }
    }
  }
  let k = Math.max(1, Math.sqrt(s.shapes.length / 12))
  let sx = 20 * k, sy = 14 * k
  scan(x0, x1, y0, y1, sx, sy)
  spots.sort((a, b) => a[0] - b[0])
  let close = spots.filter(([c]) => c < 1e5 && c < spots[0][0] + 4 * VIS)
  let every = Math.ceil(close.length / 60)
  let few = close.filter((_, i) => i % every == 0)
    .map(([c, x, y]): [number, number, number, number] => [
      c + blind([x, y], near),
      x,
      y,
      c,
    ])
    .sort((a, b) => a[0] - b[0])
  // The best few places apart from each other, each refined, and the one
  // whose lines, drawn, cost least.
  let apart = few.reduce<[number, number, number, number][]>(
    (kept, f) =>
      kept.length < 4 &&
        kept.every(([, x, y]) => Math.hypot(f[1] - x, f[2] - y) > 60)
        ? [...kept, f]
        : kept,
    [],
  )
  let best: [number, number, number] | undefined
  for (let [, fx, fy, base] of apart) {
    spots = [[base, fx, fy]]
    scan(fx - sx, fx + sx, fy - sy, fy + sy, 5 * k, 4 * k)
    let [[c, x, y]] = spots.sort((a, b) => a[0] - b[0])
    c += blind([x, y], near) + s.lines([x, y])
    if (!best || c < best[0]) best = [c, x, y]
  }
  if (best) return [best[1], best[2]]
  let across: number[] = []
  for (let x = left; x <= right; x += s.w / 2) across.push(x)
  across.sort((a, b) => Math.abs(a - ax) - Math.abs(b - ax))
  // Shapes are only ever added, so a row found full stays full.
  for (let y = Math.max(top, s.boxes.full);; y += s.h, s.boxes.full = y) {
    for (let x of across) if (!s.boxes.covered([x, y], s.w, s.h)) return [x, y]
  }
}

// The points a line is reckoned through.
const STEPS = 12
let traced = (from: string, to: string, c: Curve): Route => {
  let pts = Array.from({ length: STEPS + 1 }, (_, i) => on(c, i / STEPS))
  let xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  return {
    from,
    to,
    pts,
    box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  }
}

// Where along a line its name may be written: the middle first, then each
// way from it.
const MIDS = [.5, .4, .6, .3, .7, .22, .78]

// How far aside a line may bend, at its middle: straight first, then each
// way, further each time.
const BENDS = [0, 28, -28, 56, -56, 90, -90, 130, -130, 180, -180, 240, -240]

// The bend a new line takes between two placed shapes: the one that runs
// through no other shape, crosses fewest lines and keeps clear of the lines
// beside it, bending no more than it must.
let route = (
  a: Seat & { eid: string },
  b: Seat & { eid: string },
  shapes: Sheet['shapes'],
  routes: Route[],
  [width, height]: Spot,
): [number, Route, number] => {
  let chord = Math.hypot(b.x - a.x, b.y - a.y)
  let best: [number, number, Route] | undefined
  for (let bend of BENDS) {
    if (bend && Math.abs(bend) > Math.max(chord, 60)) continue
    let r = traced(a.eid, b.eid, curve(a, b, bend))
    let c = Math.abs(bend) * 2
    if (best && c >= best[0]) break
    let [x0, y0, x1, y1] = r.box
    if (x0 < 16 || y0 < 16 || x1 > width - 16 || y1 > height - 16) c += THROUGH
    for (let o of shapes) {
      let [x, y, w, h] = o
      if (o.eid == a.eid || o.eid == b.eid) continue
      if (!over(r.box, [x - w - 6, y - h - 6, x + w + 6, y + h + 6])) continue
      if (
        r.pts.some((p, i) =>
          i > 0 && meets(r.pts[i - 1], p, [x, y], w + 6, h + 6)
        )
      ) {
        c += THROUGH
      }
    }
    for (let o of routes) {
      if (!over(r.box, o.box)) continue
      let shared = o.from == a.eid || o.from == b.eid || o.to == a.eid ||
        o.to == b.eid
      if (!shared) {
        if (r.pts.some((p, i) => i > 0 && crossing(r.pts[i - 1], p, o))) {
          c += CROSS
        }
        continue
      }
      let inner = (pts: Spot[]) => pts.slice(2, -2)
      let close = inner(r.pts).some(([x, y]) =>
        inner(o.pts).some(([u, v]) => Math.hypot(x - u, y - v) < 12)
      )
      if (close) c += OVER
    }
    if (!best || c < best[0]) best = [c, bend, r]
  }
  return [best![1], best![2], best![0]]
}

// The sheet a selection is laid out on: the one asked for, or, when the
// shapes and the room around them would not fit it, one as many times larger
// across as down, so a big graph fills a drawing of the same shape instead of
// running down a column of it.
const ROOM = 2.4
let fitted = (width: number, height: number, sizes: [number, number][]) => {
  let need = sizes.reduce(
    (a, [w, h]) => a + (2 * w + APART) * (2 * h + APART),
    0,
  )
  let grow = Math.max(1, Math.sqrt(need * ROOM / (width * height)))
  return [width * grow, height * grow]
}

/**
 * Lay out a selection. Entities in `was` keep their places and order, and
 * lines between them their bends; each new one takes the cheapest free spot,
 * clear of the lines and shapes there, and each new line bends around what is
 * in its way. A selection too big for the sheet gets a larger one of the same
 * shape, and the sheet grows downward when nothing on it is free.
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
  let { shapes = SHAPES, stage = 0 } = opts
  let old = new Map(was?.nodes.map((n) => [n.eid, n]))
  let oldLinks = new Map(was?.links.map((l) => [l.key, l]))
  let drawn = bundles.filter((b) => !isEdge(b)).map((b) => {
    let comps = words(b, quiet)
    let state = stateOf(b)
    let shape = comps.map((c) => shapes[c]).find(Boolean) ?? 'box'
    return { b, comps, state, shape, size: half(shape, !!state) }
  })
  let [width, height] = fitted(
    opts.width ?? was?.width ?? 640,
    opts.height ?? was?.height ?? 480,
    drawn.map((d) => d.size),
  )
  let lines = links(bundles)
  let spot = new Map<string, Spot>()
  let boxes = bands()
  let put = (eid: string, p: Spot, [w, h]: [number, number]) => (
    spot.set(eid, p), boxes.add([...p, w, h])
  )
  for (let { b, size } of drawn) {
    let o = old.get(b.entity.eid)
    if (o) put(o.eid, [o.x, o.y], size)
  }
  for (let { b, size } of drawn) {
    let eid = b.entity.eid
    if (spot.has(eid)) continue
    let pin = opts.at?.({ eid, label: label(b), bundle: b })
    if (pin) put(eid, [pin[0] * width, pin[1] * height], size)
  }
  let byEid = new Map(bundles.map((b) => [b.entity.eid, b]))
  let seat = new Map(drawn.map((d) => [d.b.entity.eid, d]))
  let sizeOf = (eid: string) => seat.get(eid)!.size
  let seated = (eid: string) => {
    let [x, y] = spot.get(eid)!, d = seat.get(eid)!
    return { eid, x, y, shape: d.shape, state: d.state }
  }
  let shapesPlaced = () =>
    [...spot].map(([eid, [x, y]]) =>
      Object.assign([x, y, ...sizeOf(eid)] as Placed, { eid })
    )
  // Each line's bend once both its ends are placed, and what it is drawn
  // through. A line both of whose ends were drawn before keeps its bend.
  let bends = new Map<string, number>()
  let routes: Route[] = []
  let kept = (l: Line) =>
    old.has(l.from) && old.has(l.to) ? oldLinks.get(l.key) : undefined
  let draw = (l: Line) => {
    let a = seated(l.from), b = seated(l.to)
    let bend = kept(l)?.bend
    if (bend != null) {
      bends.set(l.key, bend)
      routes.push(traced(l.from, l.to, curve(a, b, bend)))
      return
    }
    let [chosen, r] = route(a, b, shapesPlaced(), routes, [width, height])
    bends.set(l.key, chosen)
    routes.push(r)
  }
  let ready = () => {
    for (let l of lines) {
      if (!bends.has(l.key) && spot.has(l.from) && spot.has(l.to)) draw(l)
    }
  }
  ready()
  // Actors (people, personas, sessions) are what most lines run to, so each
  // keeps to a side of the sheet, the emptier one, and the rest gather
  // between them.
  let actor = (shape: Shape) => shape == 'round' || shape == 'hex'
  let sideOf = (w: number) => {
    let xs = [...spot].filter(([e]) => actor(seat.get(e)!.shape))
      .map(([, [x]]) => x)
    let lefts = xs.filter((x) => x < width / 2).length
    return lefts <= xs.length - lefts ? w + EDGE : width - w - EDGE
  }
  let joined = new Map<string, Line[]>()
  for (let l of lines) {
    for (let e of [l.from, l.to]) joined.set(e, [...joined.get(e) ?? [], l])
  }
  let other = (l: Line, eid: string) => l.from == eid ? l.to : l.from
  let near = (eid: string) =>
    (joined.get(eid) ?? []).filter((l) => spot.has(other(l, eid))).length
  // Newcomers are placed one at a time, the one with the most lines to what
  // is already placed first (in the order given when even), so each lands
  // beside what it names, and its lines are drawn before the next lands.
  let waiting = drawn.filter(({ b }) => !spot.has(b.entity.eid))
  while (waiting.length) {
    let i = waiting.reduce(
      (best, d, j) =>
        near(d.b.entity.eid) > near(waiting[best].b.entity.eid) ? j : best,
      0,
    )
    let [{ b, size: [w, h] }] = waiting.splice(i, 1)
    let eid = b.entity.eid
    let reach = (joined.get(eid) ?? []).flatMap((l): Near[] => {
      let o = other(l, eid), at = spot.get(o)
      return at ? [{ eid: o, at, w: sizeOf(o)[0], h: sizeOf(o)[1] }] : []
    })
    let shapes = shapesPlaced()
    let d = seat.get(eid)!
    let side = actor(d.shape) ? sideOf(w) : undefined
    // Its lines to what is placed, drawn from p as they would be.
    let mine = (joined.get(eid) ?? []).filter((l) => spot.has(other(l, eid)))
    let lines = ([x, y]: Spot) => {
      let more = [...routes]
      return mine.reduce((c, l) => {
        let me = { eid, x, y, shape: d.shape, state: d.state }
        let them = seated(other(l, eid))
        let [, r, cost] = l.from == eid
          ? route(me, them, shapes, more, [width, height])
          : route(them, me, shapes, more, [width, height])
        more.push(r)
        return c + cost
      }, 0)
    }
    let at = place({
      boxes,
      shapes,
      routes,
      reach,
      width,
      height,
      w,
      h,
      side,
      lines,
    })
    put(eid, at, [w, h])
    ready()
  }
  // Where each line's name is written: kept, or the spot along it nearest
  // its middle that covers no shape and no other name.
  let mids = new Map<string, number>()
  let names: Tag['box'][] = []
  let plates = shapesPlaced().map(([x, y, w, h]): Tag['box'] => [
    x - w - 3,
    y - h - 3,
    x + w + 3,
    y + h + 3,
  ])
  let edgeOf = (l: Line) => {
    let edge = l.eid ? byEid.get(l.eid) : undefined
    return edge ? label(edge) : l.eid ? '' : undefined
  }
  for (let pass of [true, false]) {
    for (let l of lines) {
      let mid = kept(l)?.mid
      if ((mid != null) != pass) continue
      let c = curve(seated(l.from), seated(l.to), bends.get(l.key)!)
      let at = (t: number) => tag(c, t, l.name, edgeOf(l)).box
      let costOf = (t: number) => {
        let box = at(t)
        return [...plates, ...names].filter((b) => over(box, b)).length *
            1000 +
          (box[0] < 0 || box[2] > width ? 500 : 0) +
          Math.abs(t - .5) * 100
      }
      let t = mid ?? MIDS.reduce((a, b) => costOf(b) < costOf(a) ? b : a)
      mids.set(l.key, t)
      names.push(at(t))
    }
  }
  let next = Math.max(-1, ...(was?.nodes ?? []).map((n) => n.order)) + 1
  let nodes = drawn.map(({ b, comps, state, shape }): Node => {
    let eid = b.entity.eid, o = old.get(eid), [x, y] = spot.get(eid)!
    return {
      eid,
      label: label(b),
      title: titled(b),
      comps,
      shape,
      ...state ? { state } : {},
      order: o?.order ?? next++,
      stage: o?.stage ?? stage,
      x,
      y,
      fresh: !o,
    }
  })
  let after = Math.max(-1, ...(was?.links ?? []).map((l) => l.order)) + 1
  return {
    width,
    height: Math.max(
      height,
      ...drawn.map(({ b, size }) =>
        spot.get(b.entity.eid)![1] + size[1] + APART
      ),
    ),
    nodes,
    links: lines.map((l) => {
      let o = oldLinks.get(l.key)
      let edge = l.eid ? byEid.get(l.eid) : undefined
      return {
        ...l,
        ...edge ? { label: label(edge) } : {},
        bend: bends.get(l.key)!,
        mid: mids.get(l.key)!,
        order: o?.order ?? after++,
        stage: o?.stage ?? stage,
        fresh: !o,
      }
    }),
  }
}
