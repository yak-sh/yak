// Each thing a hero carries, drawn as a small picture from its own boxes
// (items.ts `look`), as the world draws it: seen from a little above, its top
// lit, its sides in shade, metal shining across each face, and a dark line
// round it. Each look says how it is best seen (items.ts `View`): a boot in
// profile, a chestplate from the front, a sword lying corner to corner. Each
// is drawn the first time it is asked for and kept, so the pack, the crafting
// and the toasts show what the hero holds.
import type { Box } from './boxes.ts'
import { ITEMS, type View } from './items.ts'
>>>>>>> 7e18319f (Mossvale: a model built of boxes never draws two faces in one plane. Its boxes are one solid (boxes.ts): each is worn over those before it, a side within a step (5 mm, mesh.ts STEP) of an earlier box's same side standing a step outside it, or flush where both are the same stuff; and a face is drawn only where it shows, cut where another box lies against it or over it. A figure's parts are worn over the parts before them that stand square to them as it is built (parts.ts knit), so a thigh no longer flickers against a flank. Figures, a thing's look, logs and stumps and a foundation all go through it; mesh.ts `fights` finds any two faces the depth buffer cannot tell apart, and tests over every creature, every hero's dress, every look and every prop find none (T-40879))
import { materialOf, METAL } from './mesh.ts'

type P = [number, number]
type Vec = [number, number, number]

/** One face of a box as the picture shows it: its corners, in pixels, its
 * colour, and whether it is metal, drawn bright to dark across it. */
export type Face = { at: P[]; rgb: number; metal: boolean }

// Where each view stands, in degrees: turned `yaw` round from the look's
// front (+z) toward its right side (+x), looking down `pitch`; a picture that
// `lean`s is turned that far after, so a long thing lies corner to corner.
let VIEWS: Record<View, { yaw: number; pitch: number; lean?: number }> = {
  corner: { yaw: 45, pitch: 35.26 },
  front: { yaw: 22, pitch: 18 },
  side: { yaw: 68, pitch: 18 },
  top: { yaw: 22, pitch: 58 },
  lying: { yaw: 45, pitch: 35.26, lean: 45 },
}

// A point of a model as a view sees it: how far right, how far up, and how
// near the eye.
let eye = (view: View) => {
  let { yaw, pitch } = VIEWS[view]
  let [cy, sy] = [Math.cos, Math.sin].map((f) => f(yaw * Math.PI / 180))
  let [cp, sp] = [Math.cos, Math.sin].map((f) => f(pitch * Math.PI / 180))
  return ([x, y, z]: Vec): Vec => {
    let near = x * sy + z * cy
    return [x * cy - z * sy, y * cp - near * sp, y * sp + near * cp]
  }
}

// How much light a face gets by which way it faces, as the eye sees it: the
// light comes from above and a little to the left, so from the corner a top
// gets 1.08, the left side 0.8 and the right 0.62.
let lit = ([right, up]: Vec) => 5 / 6 - 0.1273 * right + 0.3021 * up

let shade = (rgb: number, k: number) =>
  [16, 8, 0].reduce(
    (c, s) => c | (Math.min(255, Math.round(((rgb >> s) & 255) * k)) << s),
    0,
  )

// The faces of a box that turn toward the eye, as `see` sees them: each
// square to an axis, at its low or high end.
let sides = (see: (v: Vec) => Vec) => ([lo, size, rgb]: Box) =>
  [0, 1, 2].flatMap((a) =>
    [0, 1].flatMap((end) => {
      let n: Vec = [0, 0, 0]
      n[a] = end ? 1 : -1
      let facing = see(n)
      if (facing[2] < 1e-6) return []
      let [b, c] = [(a + 1) % 3, (a + 2) % 3]
      let at = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([i, j]) => {
        let p: Vec = [...lo]
        p[a] += end * size[a]
        p[b] += i * size[b]
        p[c] += j * size[c]
        return see(p)
      })
      return [{
        at,
        rgb: shade(rgb, lit(facing)),
        metal: materialOf(rgb) == METAL,
      }]
    })
  )

// The boxes in the order they are drawn, the farthest first: one wholly past
// another along an axis the eye looks down is behind it, and among those with
// nothing left behind them the farthest middle goes first.
let order = (look: Box[], see: (v: Vec) => Vec): Box[] => {
  let toward = [0, 1, 2].map((a) => see([+(a == 0), +(a == 1), +(a == 2)])[2])
  let behind = ([a, as]: Box, [b, bs]: Box) =>
    [0, 1, 2].some((i) =>
      toward[i] > 1e-6
        ? a[i] + as[i] <= b[i] + 1e-6
        : toward[i] < -1e-6 && a[i] >= b[i] + bs[i] - 1e-6
    )
  let depth = ([[x, y, z], [w, h, d]]: Box) =>
    see([x + w / 2, y + h / 2, z + d / 2])[2]
  let left = [...look].sort((a, b) => depth(a) - depth(b))
  let drawn: Box[] = []
  while (left.length) {
    let i = left.findIndex((b) => !left.some((a) => a != b && behind(a, b)))
    drawn.push(...left.splice(Math.max(i, 0), 1))
  }
  return drawn
}

/** A model's faces on a square picture `size` pixels on a side, the farthest
 * first, fitted inside `pad` pixels of margin, as `view` sees it.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { metal } from './mesh.ts'
 * import type { Box, View } from './items.ts'
 * let span = (fs: Face[], i: number) => {
 *   let vs = fs.flatMap((f) => f.at.map((p) => p[i]))
 *   return Math.max(...vs) - Math.min(...vs)
 * }
 * // a cube from its corner shows three faces, its top the lightest
 * let cube = faces([[[0, 0, 0], [1, 1, 1], 0x808080]], 64, 4)
 * assertEquals(cube.map((f) => f.rgb).sort(), [0x4f4f4f, 0x666666, 0x8a8a8a])
 * assertEquals(Math.round(span(cube, 1)), 56)
 * // a pole lying leans over, its foot at the bottom left
 * let pole = faces([[[0, 0, 0], [0.1, 2, 0.1], 0x808080]], 64, 4, 'lying')
 * let foot = pole[0].at[0]
 * assertEquals(foot[0] < 32 && foot[1] > 32, true)
 * // a plate standing face on is wide from the front and thin from the side
 * let plate: Box[] = [[[0, 0, 0], [1, 1, 0.1], 0x808080]]
 * let wide = (v: View) => span(faces(plate, 64, 4, v), 0)
 * assertEquals(wide('front') > 2 * wide('side'), true)
 * // what stands before another is drawn after it, whatever its size
 * let slab: Box = [[-1, 0, -1], [2, 0.1, 2], 0x101010]
 * let knob: Box = [[-0.9, 0.1, -0.9], [0.1, 0.1, 0.1], 0x808080]
 * let fs = faces([knob, slab], 64, 4)
 * assertEquals(fs.slice(-3).every((f) => (f.rgb & 255) > 0x40), true)
 * // a blade's faces are metal, and shine
 * let blade = faces([[[0, 0, 0], [0.1, 1, 0.02], metal(0xdfe6ee)]], 64, 4)
 * assertEquals(blade.map((f) => f.metal), [true, true, true])
 * ```
 */
export let faces = (
  look: Box[],
  size: number,
  pad: number,
  view: View = 'corner',
): Face[] => {
  let see = eye(view)
  let all = order(look, see).flatMap(sides(see))
  let turn = (VIEWS[view].lean ?? 0) * Math.PI / 180
  let c = Math.cos(turn), s = Math.sin(turn)
  // Right and up become right and down, turned by the lean.
  let flat = ([x, y]: Vec): P => [x * c + y * s, x * s - y * c]
  let pts = all.flatMap((f) => f.at.map(flat))
  let xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  let [x0, y0] = [Math.min(...xs), Math.min(...ys)]
  let [x1, y1] = [Math.max(...xs), Math.max(...ys)]
  let k = (size - 2 * pad) / Math.max(x1 - x0, y1 - y0, 1e-6)
  let ox = (size - (x1 - x0) * k) / 2, oy = (size - (y1 - y0) * k) / 2
  let fit = (v: Vec): P => {
    let [x, y] = flat(v)
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
  let thing = ITEMS[kind]
  url = ''
  if (thing?.look.length) {
    let canvas = document.createElement('canvas')
    canvas.width = canvas.height = SIZE
    let g = canvas.getContext('2d')!
    let fs = faces(thing.look, SIZE, 7, thing.view)
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
    // The faces, each edged in its own colour so no seam shows between; a
    // metal one bright at one corner and dark at the far one.
    g.lineWidth = 0.8
    for (let f of fs) {
      path(f)
      let [[x0, y0], , [x1, y1]] = f.at
      let paint: string | CanvasGradient = hex(f.rgb)
      if (f.metal) {
        paint = g.createLinearGradient(x0, y0, x1, y1)
        paint.addColorStop(0, hex(shade(f.rgb, 1.35)))
        paint.addColorStop(0.45, hex(f.rgb))
        paint.addColorStop(1, hex(shade(f.rgb, 0.7)))
      }
      g.fillStyle = g.strokeStyle = paint
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
