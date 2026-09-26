// Each thing a hero carries, drawn as a small picture from its own boxes
// (items.ts `look`), as the world draws it: seen from above and in front, its
// top lit, its sides in shade, and a dark line round it. A long thing, a
// sword or a staff, lies corner to corner. Each is drawn the first time it is
// asked for and kept, so the pack, the crafting and the toasts show what the
// hero holds.
import { type Box, ITEMS } from './items.ts'

type P = [number, number]
type Vec = [number, number, number]

/** One face of a box as the picture shows it: its corners, in pixels, and
 * its colour. */
export type Face = { at: P[]; rgb: number }

// How much light each face a picture shows gets: the top, the side to the
// left, the side to the right.
let TOP = 1.08, LEFT = 0.8, RIGHT = 0.62

// A point of a model on the picture: x runs right and down, z left and down,
// and y up, so the top and the two near sides show.
let COS = Math.cos(Math.PI / 6), SIN = Math.sin(Math.PI / 6)
let flat = ([x, y, z]: Vec): P => [(x - z) * COS, (x + z) * SIN - y]

let shade = (rgb: number, k: number) =>
  [16, 8, 0].reduce(
    (c, s) => c | (Math.min(255, Math.round(((rgb >> s) & 255) * k)) << s),
    0,
  )

// The three faces of a box that show, as it lies in the model.
let sides = ([[x, y, z], [w, h, d], rgb]: Box): Face[] => {
  let X = x + w, Y = y + h, Z = z + d
  let face = (k: number, ...at: Vec[]) => ({
    at: at.map(flat),
    rgb: shade(rgb, k),
  })
  return [
    face(LEFT, [x, y, Z], [X, y, Z], [X, Y, Z], [x, Y, Z]),
    face(RIGHT, [X, y, z], [X, Y, z], [X, Y, Z], [X, y, Z]),
    face(TOP, [x, Y, z], [X, Y, z], [X, Y, Z], [x, Y, Z]),
  ]
}

// How far a box lies from the eye: the farthest are drawn first.
let far = ([[x, y, z], [w, h, d]]: Box) => x + w / 2 + y + h / 2 + z + d / 2

/** A model's faces on a square picture `size` pixels on a side, the farthest
 * first, fitted inside `pad` pixels of margin. One much taller than it is
 * wide lies corner to corner, its foot at the bottom left.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let cube = faces([[[0, 0, 0], [1, 1, 1], 0x808080]], 64, 4)
 * // its left side, its right side and its top, the top lightest
 * assertEquals(cube.map((f) => f.rgb), [0x666666, 0x4f4f4f, 0x8a8a8a])
 * let ys = cube.flatMap((f) => f.at.map(([, y]) => y))
 * assertEquals([Math.min(...ys), Math.max(...ys)].map(Math.round), [4, 60])
 * // a pole leans over to fill the square
 * let pole = faces([[[0, 0, 0], [0.1, 2, 0.1], 0x808080]], 64, 4)
 * let foot = pole[0].at[0]
 * assertEquals(foot[0] < 32 && foot[1] > 32, true)
 * ```
 */
export let faces = (look: Box[], size: number, pad: number): Face[] => {
  let all = [...look]
    .sort((a, b) => far(a) - far(b))
    .flatMap(sides)
  let pts = all.flatMap((f) => f.at)
  let box = (ps: P[]) => {
    let xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1])
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  }
  let [x0, y0, x1, y1] = box(pts)
  // Long: turned an eighth of the way round, so its top leans right.
  let turn = y1 - y0 > 1.8 * (x1 - x0) ? Math.PI / 4 : 0
  let c = Math.cos(turn), s = Math.sin(turn)
  let spin = ([x, y]: P): P => [x * c - y * s, x * s + y * c]
  ;[x0, y0, x1, y1] = box(pts.map(spin))
  let k = (size - 2 * pad) / Math.max(x1 - x0, y1 - y0, 1e-6)
  let ox = (size - (x1 - x0) * k) / 2, oy = (size - (y1 - y0) * k) / 2
  let fit = (p: P): P => {
    let [x, y] = spin(p)
    return [ox + (x - x0) * k, oy + (y - y0) * k]
  }
  return all.map((f) => ({ ...f, at: f.at.map(fit) }))
}

let hex = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`

// How big each picture is drawn, in pixels, to stay sharp on a dense screen.
let SIZE = 96
let INK = 'rgba(38, 32, 22, 0.9)'

let drawn = new Map<string, string>()

/** The picture of a kind of thing, as a URL an image can show; '' for a kind
 * nothing knows. */
export let sprite = (kind: string): string => {
  let url = drawn.get(kind)
  if (url != null) return url
  let look = ITEMS[kind]?.look
  url = ''
  if (look?.length) {
    let canvas = document.createElement('canvas')
    canvas.width = canvas.height = SIZE
    let g = canvas.getContext('2d')!
    let fs = faces(look, SIZE, 7)
    let path = (f: Face) => {
      g.beginPath()
      f.at.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y))
      g.closePath()
    }
    // The line round it: every face, drawn fat in ink, under the faces.
    g.lineJoin = 'round'
    g.lineWidth = 7
    g.strokeStyle = g.fillStyle = INK
    for (let f of fs) {
      path(f)
      g.fill()
      g.stroke()
    }
    // The faces, each edged in its own colour so no seam shows between.
    g.lineWidth = 0.8
    for (let f of fs) {
      path(f)
      g.fillStyle = g.strokeStyle = hex(f.rgb)
      g.fill()
      g.stroke()
    }
    url = canvas.toDataURL()
  }
  drawn.set(kind, url)
  return url
}

/** A kind's picture as HTML, sized by the text around it (ui/Sprite.css). */
export let icon = (kind: string): string => {
  let url = sprite(kind)
  return url ? `<img class=Sprite src="${url}" alt="">` : ''
}
