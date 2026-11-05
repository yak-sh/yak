// The outline each kind of entity is drawn as, and the geometry a pen needs:
// how far a box reaches from its centre, where a line toward it meets its
// rim, and the point a fraction of the way round its outline. Pure.

/** How an entity is outlined: a box, a circle (a person), a hexagon (an
 * agent) or a note with a folded corner (a comment). */
export type Shape = 'box' | 'round' | 'hex' | 'note'

/** The shape each component draws its entity as; any other is a box. */
export const SHAPES: Record<string, Shape> = {
  person: 'round',
  persona: 'hex',
  session: 'hex',
  comment: 'note',
}

/** A shape's half width and half height, with room for the title a round
 * shape writes under itself. */
export let half = (shape: Shape, task = false): [number, number] =>
  shape == 'round' || shape == 'hex'
    ? [46, 44]
    : shape == 'note'
    ? [70, 25]
    : task
    ? [79, 28]
    : [72, 25]

/** A round shape's radius. */
export let radius = (shape: Shape) => shape == 'round' ? 23 : 25

type Spot = [number, number]

// A shape's outline as the corners a pen walks, starting top left (or top)
// and going clockwise; a circle is walked as many short sides.
let corners = (shape: Shape, task: boolean): Spot[] => {
  if (shape == 'round' || shape == 'hex') {
    let r = radius(shape), n = shape == 'hex' ? 6 : 48
    return Array.from({ length: n }, (_, i) => {
      let a = 2 * Math.PI * i / n - Math.PI / 2
      return [Math.cos(a) * r, Math.sin(a) * r]
    })
  }
  let [w, h] = half(shape, task)
  return shape == 'note'
    ? [[-w, -h], [w - 9, -h], [w, -h + 9], [w, h], [-w, h]]
    : [[-w, -h], [w, -h], [w, h], [-w, h]]
}

let n = (x: number) => +x.toFixed(1)

/** A shape's outline as an SVG path, centred on 0,0. */
export let outline = (shape: Shape, task = false): string => {
  if (shape == 'round') {
    let r = radius(shape)
    return `M0,${-r}A${r},${r} 0 1 1 0,${r}A${r},${r} 0 1 1 0,${-r}Z`
  }
  let [[x, y], ...rest] = corners(shape, task)
  return `M${n(x)},${n(y)}` +
    rest.map(([a, b]) => `L${n(a)},${n(b)}`).join('') +
    'Z'
}

/** Where a line from a shape's centre toward (dx, dy) leaves it, a little
 * outside so an arrowhead rests on the rim. */
export let rim = (
  shape: Shape,
  task: boolean,
  dx: number,
  dy: number,
): Spot => {
  if (shape == 'round' || shape == 'hex') {
    let l = Math.hypot(dx, dy) || 1, r = radius(shape) + 3
    return [dx / l * r, dy / l * r]
  }
  let [w, h] = half(shape, task)
  let t = Math.min(
    (w + 3) / (Math.abs(dx) || 1e-9),
    (h + 3) / (Math.abs(dy) || 1e-9),
  )
  return [dx * t, dy * t]
}

/** The point a fraction `t` of the way round a shape's outline. */
export let along = (shape: Shape, task: boolean, t: number): Spot => {
  let pts = corners(shape, task)
  let sides = pts.map((p, i): [Spot, Spot, number] => {
    let q = pts[(i + 1) % pts.length]
    return [p, q, Math.hypot(q[0] - p[0], q[1] - p[1])]
  })
  let left = Math.max(0, Math.min(1, t)) *
    sides.reduce((s, [, , l]) => s + l, 0)
  for (let [[ax, ay], [bx, by], l] of sides) {
    if (left <= l) {
      let u = l ? left / l : 0
      return [ax + (bx - ax) * u, ay + (by - ay) * u]
    }
    left -= l
  }
  return pts[0]
}

/** A line's curve: from one rim, bending through a control point, to the
 * other rim. */
export type Curve = {
  x0: number
  y0: number
  cx: number
  cy: number
  x1: number
  y1: number
}

/** The point a fraction `t` along a curve. */
export let on = (c: Curve, t: number): Spot => {
  let u = 1 - t
  return [
    u * u * c.x0 + 2 * u * t * c.cx + t * t * c.x1,
    u * u * c.y0 + 2 * u * t * c.cy + t * t * c.y1,
  ]
}
