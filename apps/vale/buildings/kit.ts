// What a building is made of. A kind of building is a Plan: its footprint,
// and storey by storey its walls, doors, windows, stairs and what furnishes
// it, each a Piece placed in the room or against a wall. A land's materials
// are a Dress. `raise` builds a plan in a dress as voxels a quarter of a
// metre across, and says where its doors hang, where its floors are, and
// where each thing in it is used, lit and worked. The page draws those
// voxels and a walker and the camera meet the same ones (solid.ts), so a
// building is solid exactly where it is drawn.
//
// A plan is written facing south, its front on the +z side, in metres from
// the middle of its footprint, on a quarter-metre grid; a village turns it to
// face its square (terrain.ts). What cannot stand where a plan puts it (a
// piece through a wall, a table on the stairs, a chest before a door, a
// window over the chimney) throws as the building is raised, naming both.
import { key, unkey, type Vec, type Vox } from '../mesh.ts'
import type { Craft } from '../trades.ts'

/** A voxel's edge, in metres. */
export let S = 0.25

export type Side = 'north' | 'east' | 'south' | 'west'

/** A colour, or one chosen by where a voxel is and the building's seed. */
export type Paint =
  | number
  | ((x: number, y: number, z: number, seed: number) => number)

/** A land's materials: what walls, footings, frames, floors and roofs are
 * made of, the colour of its doors and shutters, whether its walls are
 * framed in timber (posts, a beam at each floor, studs and braces), and how
 * high its floors stand over the ground, in metres (a footing's half metre,
 * or stilts). */
export type Dress = {
  wall: Paint
  stone: Paint
  timber: number
  floor: Paint
  roofs: number[]
  door: number
  trim: number
  framed?: boolean
  plinth?: number
}

/** A door or a window in a wall: which wall, how far along it its middle
 * is, in metres (east or south of the building's middle is positive), and
 * how wide and tall it is. */
export type Opening = { side: Side; at: number; wide?: number; tall?: number }

/** A piece of furniture stood in a room, its middle `at` (metres) and its
 * front toward `face`; or against a wall's inside (`on`), `at` metres along
 * it, facing into the room. */
export type Place =
  | { piece: Piece; at: [number, number]; face?: Side }
  | { piece: Piece; on: Side; at: number }

/** One storey: its height floor to floor (the top one's, floor to eaves),
 * what its walls are made of, its doors and windows, a flight of stairs up to
 * the next storey (against the wall `on`, its foot `from` metres along it,
 * climbing toward `to`), and what furnishes it. */
export type Storey = {
  height: number
  walls?: 'wall' | 'stone'
  doors?: Opening[]
  windows?: Opening[]
  stairs?: { on: Side; from: number; to: Side; wide?: number }
  furnish?: Place[]
}

/** A kind of building: its name, its walls' outside (metres east–west and
 * north–south, in half metres), its storeys from the ground up, a chimney
 * stack up the outside of a wall (`at` metres along it), who works there
 * (villagers.ts), and whatever only it has (`more`), built last. */
export type Plan = {
  name: string
  size: [number, number]
  storeys: Storey[]
  chimney?: { on: Side; at: number; wide?: number }
  works?: string
  more?: (k: Kit) => void
}

/** A piece of furniture: its voxels, front to the south and standing on
 * the floor (`y` 0; −1 is laid into the floor, as a rug is), in the dress's
 * materials; where someone stands to use it and what for (a cell of its
 * voxels, which is kept clear), a light, and the station it is (craft.ts). */
export type Piece = {
  name: string
  make: (d: Dress, seed: number) => Vox
  use?: { at: [number, number]; for: string }
  glow?: Glow
  station?: Craft
}

/** A door's leaf, in metres: the hinge at the foot of the jamb it hangs
 * from, which way the leaf runs from it when shut (`along`), which way is
 * in, where it swings, and its size and colour. */
export type Door = {
  hinge: Vec
  along: [number, number]
  into: [number, number]
  wide: number
  tall: number
  color: number
}

/** Where someone stands to use a thing, what for, and which way they face,
 * in metres and radians (0 faces +z). */
export type Use = { for: string; at: Vec; yaw: number }
/** A light: where, how big its halo is, in metres, and its colour. */
export type Glow = { at: Vec; size: number; color?: number; fire?: boolean }

/** A building raised: its voxels, their edge and where voxel (0, 0, 0)'s
 * corner is, in metres (a Model, props/kit.ts); its doors; each storey's
 * floor and then its eaves, in metres up from its foot; where things are
 * used, lit and worked; and its footprint, metres. */
export type Raised = {
  vox: Vox
  size: number
  at: Vec
  doors: Door[]
  floors: number[]
  uses: Use[]
  glows: Glow[]
  stations: { craft: Craft; at: Vec }[]
  foot: [number, number]
}

/** What a plan's `more` builds with: the building's extents in voxels (its
 * walls' rows, each storey's floor and the eaves), its dress and seed, and
 * ways to set voxels, clear them and place pieces. */
export type Kit = {
  x0: number
  x1: number
  z0: number
  z1: number
  floors: number[]
  dress: Dress
  seed: number
  /** a voxel `d` in from wall `side` (0 its row, −1 outside it), `t` along */
  cell: (side: Side, t: number, d: number) => [number, number]
  put: (x: number, y: number, z: number, p: Paint, who?: string) => void
  box: (a: Vec, b: Vec, p: Paint, who?: string) => void
  /** a piece outside, on the ground its door steps down to */
  place: (piece: Piece, at: [number, number], face?: Side) => void
}

/** A paint's colour at a voxel. */
export let paint = (p: Paint, x: number, y: number, z: number, seed: number) =>
  typeof p == 'number' ? p : p(x, y, z, seed)

// Quarter turns, as a building or a piece turns: its front faces south,
// east, north, west. A voxel turns about the middle of the grid's corners.
let TURNS: Side[] = ['south', 'east', 'north', 'west']
export let turnOf = (s: Side) => TURNS.indexOf(s)
let spinCell = (x: number, z: number, t: number, c = 1): [number, number] => {
  for (let i = 0; i < ((t % 4) + 4) % 4; i++) [x, z] = [z, -x - c]
  return [x, z]
}
/** A point (metres) turned `t` quarter turns about the origin, as
 * rotation.y turns it: a quarter turn takes +z to +x.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(spin(0, 1, 1), [1, 0])
 * assertEquals(spin(2, 1, 2), [-2, -1])
 * ```
 */
export let spin = (x: number, z: number, t: number): [number, number] => {
  for (let i = 0; i < ((t % 4) + 4) % 4; i++) [x, z] = [z, -x]
  return [x + 0, z + 0]
}

/** Voxels turned `t` quarter turns about the corner at their origin, or,
 * with `c` 0, about the middle of the voxel there. */
export let spun = (v: Vox, t: number, c = 1): Vox => {
  if (!(t % 4)) return v
  let out: Vox = new Map()
  for (let [k, colour] of v) {
    let [x, y, z] = unkey(k)
    let [a, b] = spinCell(x, z, t, c)
    out.set(key(a, y, b), colour)
  }
  return out
}

class Misplaced extends Error {}

/** A plan raised in a dress: `seed` picks its roof's colour and the grain of
 * its walls.
 *
 * ```ts
 * import { assertEquals, assertThrows } from '@std/assert'
 * import { PLASTER } from './dress.ts'
 * import { chest } from './pieces.ts'
 * let hut = (furnish: Place[] = []) => raise({
 *   name: 'hut', size: [4, 4],
 *   storeys: [{ height: 2.5, doors: [{ side: 'south', at: 0 }], furnish }],
 * }, PLASTER, 0)
 * let r = hut()
 * assertEquals(r.floors, [0.5, 3])
 * assertEquals(r.doors.length, 1)
 * // A chest stood through the north wall is refused, by name.
 * assertThrows(() => hut([{ piece: chest, at: [0, -2] }]), Error, 'chest')
 * // One against the wall stands inside it.
 * assertEquals(hut([{ piece: chest, on: 'north', at: 0 }]).vox.size > r.vox.size, true)
 * ```
 */
export let raise = (plan: Plan, dress: Dress, seed: number): Raised => {
  let m = (metres: number) => Math.round(metres / S)
  let W = m(plan.size[0]), D = m(plan.size[1])
  let x0 = -W / 2, x1 = W / 2 - 1, z0 = -D / 2, z1 = D / 2 - 1
  let P = m(dress.plinth ?? 0.5)
  let floors = [P]
  for (let s of plan.storeys) {
    floors.push(floors[floors.length - 1] + m(s.height))
  }
  let eaves = floors[floors.length - 1]
  let vox: Vox = new Map()
  // What each voxel is part of, and where someone stands to use what, which
  // two uses may share but nothing may stand in.
  let own = new Map<number, string>()
  let room = new Map<number, string>()
  let doors: Door[] = [], uses: Use[] = [], glows: Glow[] = []
  let stations: Raised['stations'] = []
  let color = (p: Paint, x: number, y: number, z: number) =>
    paint(p, x, y, z, seed)
  let put = (x: number, y: number, z: number, p: Paint, who = 'wall') => {
    let k = key(x, y, z)
    vox.set(k, color(p, x, y, z))
    own.set(k, who)
  }
  let box = (a: Vec, b: Vec, p: Paint, who?: string) => {
    for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++) {
      for (let y = Math.min(a[1], b[1]); y <= Math.max(a[1], b[1]); y++) {
        for (let z = Math.min(a[2], b[2]); z <= Math.max(a[2], b[2]); z++) {
          put(x, y, z, p, who)
        }
      }
    }
  }
  let clear = (x: number, y: number, z: number, who: string) => {
    let k = key(x, y, z)
    vox.delete(k)
    own.set(k, who)
  }
  let fail = (what: string, into: string) => {
    throw new Misplaced(`${plan.name}: ${what} runs into ${into}`)
  }
  // A voxel `d` in from a wall (0 is the wall's row, −1 just outside it), `t`
  // along it; and the range along a wall an opening `at` metres wide takes.
  let cell = (s: Side, t: number, d: number): [number, number] =>
    s == 'south'
      ? [t, z1 - d]
      : s == 'north'
      ? [t, z0 + d]
      : s == 'east'
      ? [x1 - d, t]
      : [x0 + d, t]
  let ends = (s: Side): [number, number] =>
    s == 'south' || s == 'north' ? [x0, x1] : [z0, z1]
  let span = (at: number, wide: number): [number, number] => {
    let a = m(at) - Math.floor(wide / 2)
    return [a, a + wide - 1]
  }
  let inward = (s: Side): [number, number] =>
    s == 'south'
      ? [0, -1]
      : s == 'north'
      ? [0, 1]
      : s == 'east'
      ? [-1, 0]
      : [1, 0]
  let alongOf = (s: Side): [number, number] =>
    s == 'south' || s == 'north' ? [1, 0] : [0, 1]
  // A metre point at the middle of a voxel's foot.
  let at = (x: number, y: number, z: number): Vec => [
    (x + 0.5) * S,
    y * S,
    (z + 0.5) * S,
  ]

  let xyz = ([x, z]: [number, number], y: number): Vec => [x, y, z]

  // The footing, stone right through, floored inside at the top.
  box([x0, 0, z0], [x1, P - 1, z1], dress.stone)
  for (let x = x0 + 1; x < x1; x++) {
    for (let z = z0 + 1; z < z1; z++) put(x, P - 1, z, dress.floor, 'floor')
  }

  // Each storey's walls, from its floor to the next one's (the top one's to
  // its eaves, where the roof rests), and the floor over it.
  plan.storeys.forEach((s, i) => {
    let f = floors[i],
      top = i == plan.storeys.length - 1 ? eaves : floors[i + 1] - 1
    let stuff = s.walls == 'stone' ? dress.stone : dress.wall
    for (let y = f; y <= top; y++) {
      for (let x = x0; x <= x1; x++) put(x, y, z0, stuff), put(x, y, z1, stuff)
      for (let z = z0; z <= z1; z++) put(x0, y, z, stuff), put(x1, y, z, stuff)
    }
    if (i < plan.storeys.length - 1) {
      for (let x = x0 + 1; x < x1; x++) {
        for (let z = z0 + 1; z < z1; z++) put(x, top, z, dress.floor, 'floor')
      }
    }
    if (dress.framed && s.walls != 'stone') frame(f, top, i == 0)
  })

  // Timber framing: posts at the corners, a beam round the top and foot of
  // each storey, a stud every metre and a half, and a brace up from each
  // corner.
  function frame(f: number, top: number, ground: boolean) {
    let t = dress.timber
    for (let y = f; y <= top; y++) {
      for (let [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
        put(x, y, z, t)
      }
    }
    for (let y of ground ? [top] : [f, top]) {
      for (let x = x0; x <= x1; x++) put(x, y, z0, t), put(x, y, z1, t)
      for (let z = z0; z <= z1; z++) put(x0, y, z, t), put(x1, y, z, t)
    }
    for (let s of TURNS) {
      let [lo, hi] = ends(s)
      for (let a = lo + 6; a < hi - 3; a += 6) {
        for (let y = f; y <= top; y++) put(...xyz(cell(s, a, 0), y), t)
      }
      for (let k = 1; k < Math.min(4, top - f); k++) {
        put(...xyz(cell(s, lo + k, 0), top - k), t)
        put(...xyz(cell(s, hi - k, 0), top - k), t)
      }
    }
  }
  // Openings, cut through the wall where nothing else was set in it.
  let cut = (
    s: Side,
    [a, b]: [number, number],
    y0: number,
    y1: number,
    who: string,
  ) => {
    let [lo, hi] = ends(s)
    if (a - 1 <= lo || b + 1 >= hi) fail(who, `the ${s} wall's corner`)
    for (let t = a; t <= b; t++) {
      for (let y = y0; y <= y1; y++) {
        let [x, z] = cell(s, t, 0), was = own.get(key(x, y, z))
        if (was != 'wall') fail(who, was ?? 'the air')
        clear(x, y, z, who)
      }
    }
  }
  plan.storeys.forEach((s, i) => {
    let f = floors[i]
    for (let o of s.doors ?? []) door(o, f, i)
    for (let o of s.windows ?? []) window(o, f, i)
  })

  function door(o: Opening, f: number, storey: number) {
    let wide = m(o.wide ?? 1), tall = m(o.tall ?? 2.25)
    let [a, b] = span(o.at, wide)
    cut(o.side, [a, b], f, f + tall - 1, `the ${o.side} door`)
    let t = dress.timber
    for (let y = f; y <= f + tall; y++) {
      put(...xyz(cell(o.side, a - 1, 0), y), t)
      put(...xyz(cell(o.side, b + 1, 0), y), t)
    }
    for (let u = a - 1; u <= b + 1; u++) {
      put(...xyz(cell(o.side, u, 0), f + tall), t)
    }
    // The leaves, one or a pair, swinging in over floor kept clear for them.
    let [ix, iz] = inward(o.side), [ax, az] = alongOf(o.side)
    let leaves = wide >= 6 ? 2 : 1, leaf = wide / leaves
    for (let l = 0; l < leaves; l++) {
      let from = l ? b + 1 : a, sign = l ? -1 : 1
      let [hx, hz] = cell(o.side, from, 0)
      let mid = o.side == 'south' || o.side == 'north'
        ? [hx * S, (hz + 0.5) * S]
        : [(hx + 0.5) * S, hz * S]
      doors.push({
        hinge: [mid[0], f * S, mid[1]],
        along: [ax * sign, az * sign],
        into: [ix, iz],
        wide: leaf * S,
        tall: tall * S,
        color: dress.door,
      })
    }
    for (let d = 1; d <= leaf; d++) {
      for (let u = a; u <= b; u++) {
        for (let y = f; y < f + tall; y++) {
          let [x, z] = cell(o.side, u, d)
          if (own.has(key(x, y, z))) {
            fail(`the ${o.side} door`, own.get(key(x, y, z))!)
          }
          own.set(key(x, y, z), `the ${o.side} door's swing`)
        }
      }
    }
    // Outside, a step down to the ground for every quarter metre the floor
    // stands over it, each half a metre deep; and where to stand at it.
    if (!storey) {
      for (let k = 1; k < P; k++) {
        for (let u = a - 1; u <= b + 1; u++) {
          for (let d of [1 - 2 * k, -2 * k]) {
            let [x, z] = cell(o.side, u, d)
            box([x, 0, z], [x, P - 1 - k, z], dress.stone, 'the steps')
          }
        }
      }
    }
    let [cx, cz] = cell(o.side, Math.floor((a + b) / 2), 0)
    let mx = (cx + 0.5 + (wide % 2 ? 0 : ax * 0.5)) * S
    let mz = (cz + 0.5 + (wide % 2 ? 0 : az * 0.5)) * S
    let yaw = Math.atan2(ix, iz)
    uses.push({ for: 'door', at: [mx - ix * 1.5, 0, mz - iz * 1.5], yaw })
  }

  function window(o: Opening, f: number, storey: number) {
    let wide = m(o.wide ?? 1.25), tall = m(o.tall ?? 1.25)
    let sill = f + (storey ? 2 : 3)
    let [a, b] = span(o.at, wide)
    let top = sill + tall - 1
    cut(o.side, [a, b], sill, top, `the ${o.side} window`)
    let t = dress.timber, mid = Math.floor((a + b) / 2)
    for (let u = a - 1; u <= b + 1; u++) {
      put(...xyz(cell(o.side, u, 0), sill - 1), t)
      put(...xyz(cell(o.side, u, 0), top + 1), t)
      put(...xyz(cell(o.side, u, -1), sill - 1), t, 'a sill')
    }
    for (let y = sill; y <= top; y++) put(...xyz(cell(o.side, mid, 0), y), t)
    for (let u = a; u <= b; u++) {
      put(...xyz(cell(o.side, u, 0), sill + Math.floor(tall / 2)), t)
    }
    // Shutters open against the wall either side, and on an upper storey a
    // box of flowers on the sill.
    for (let y = sill; y <= top; y++) {
      for (let u of [a - 2, a - 1, b + 1, b + 2]) {
        let c = (u + y) & 1 ? dress.trim : shade(dress.trim, 0.86)
        put(...xyz(cell(o.side, u, -1), y), c, 'a shutter')
      }
    }
    if (storey) {
      for (let u = a; u <= b; u++) {
        put(...xyz(cell(o.side, u, -1), sill - 2), dress.trim, 'a window box')
        let bloom = [0xe0525a, 0xf2c14e, 0xe98ac0][(((u + seed) % 3) + 3) % 3]
        put(
          ...xyz(cell(o.side, u, -1), sill - 1),
          u & 1 ? bloom : 0x5f9a45,
          'flowers',
        )
      }
    }
  }

  // Stairs: a solid flight, a quarter metre up for each quarter metre along,
  // through a well cut in the floor above, railed round on that floor but
  // for where it arrives.
  plan.storeys.forEach((s, i) => {
    let st = s.stairs
    if (!st) return
    let f = floors[i], h = floors[i + 1] - f
    let wide = m(st.wide ?? 1)
    let dir = st.to == 'north' || st.to == 'west' ? -1 : 1
    let from = m(st.from) - (dir < 0 ? 1 : 0)
    let [lo, hi] = ends(st.on)
    let tread = shade(dress.timber, 1.25)
    for (let k = -1; k <= h; k++) {
      let t = from + k * dir
      if (t <= lo || t >= hi) {
        fail('the stairs', `the ${k < 0 ? opposite(st.to) : st.to} wall`)
      }
      for (let d = 1; d <= wide; d++) {
        let [x, z] = cell(st.on, t, d)
        let y0 = k < 0 ? f : k < h ? f : floors[i + 1]
        let who = k >= 0 && k < h
          ? 'the stairs'
          : `the way ${k < 0 ? 'onto' : 'off'} the stairs`
        for (let y = y0; y < y0 + 7; y++) {
          let got = own.get(key(x, y, z))
          if (got && got != 'wall' && got != 'floor') fail(who, got)
        }
        if (k < 0 || k >= h) {
          for (let y = y0; y < y0 + 7; y++) own.set(key(x, y, z), who)
          continue
        }
        for (let y = f; y <= f + k; y++) {
          put(
            x,
            y,
            z,
            y == f + k
              ? tread
              : (y + d) & 1
              ? dress.timber
              : shade(dress.timber, 0.9),
            'the stairs',
          )
        }
        if (k < h - 1) clear(x, f + h - 1, z, 'the stairwell')
      }
    }
    // Where to stand to go up, at its foot facing up it, and to come down,
    // on the floor above facing down it.
    let mid = (t: number, y: number): Vec => {
      let [ix, iz] = inward(st.on)
      let [x, z] = cell(st.on, t, 0)
      return at(x + ix * (wide + 1) / 2, y, z + iz * (wide + 1) / 2)
    }
    let [ux, uz] = st.on == 'north' || st.on == 'south' ? [dir, 0] : [0, dir]
    uses.push(
      { for: 'up', at: mid(from - dir, f), yaw: Math.atan2(ux, uz) },
      {
        for: 'down',
        at: mid(from + h * dir, floors[i + 1]),
        yaw: Math.atan2(-ux, -uz),
      },
    )
    // The rail on the floor above, along the well's open side and its foot.
    let up = floors[i + 1]
    let rail = (x: number, z: number, post: boolean) => {
      if (post) box([x, up, z], [x, up + 3, z], dress.timber, 'a rail')
      else put(x, up + 3, z, dress.timber, 'a rail')
    }
    for (let k = -1; k < h - 1; k++) {
      let t = from + k * dir
      if (t <= lo || t >= hi) continue
      rail(...cell(st.on, t, wide + 1), k % 2 == 0 || k == -1)
      if (k == -1) {
        for (let d = 1; d <= wide; d++) rail(...cell(st.on, t, d), d % 2 == 0)
      }
    }
  })

  // The roof: a gable over the longer way, a voxel up for every voxel in,
  // courses darker every third, the gable ends walled to its slope and
  // boarded at their edge; and the chimney up through it.
  let roofC = dress.roofs[seed % dress.roofs.length]
  let long = W >= D
  let half = (long ? D : W) / 2
  for (let l = 0; l <= half; l++) {
    let c = l % 3 == 0
      ? shade(roofC, 0.88)
      : l == half
      ? shade(roofC, 0.8)
      : roofC
    let [a0, a1] = long ? [x0 - 1, x1 + 1] : [z0 - 1, z1 + 1]
    let [b0, b1] = long ? [z0 - 1 + l, z1 + 1 - l] : [x0 - 1 + l, x1 + 1 - l]
    for (let a = a0; a <= a1; a++) {
      let edge = a == a0 || a == a1
      for (let b of [b0, b1]) {
        let [x, z] = long ? [a, b] : [b, a]
        put(x, eaves + l, z, edge ? dress.timber : c, 'the roof')
      }
    }
    for (let b = b0 + 1; b < b1 && l; b++) {
      for (let a of long ? [x0, x1] : [z0, z1]) {
        let [x, z] = long ? [a, b] : [b, a]
        put(
          x,
          eaves + l,
          z,
          dress.framed && b % 6 == 0 ? dress.timber : dress.wall,
        )
      }
    }
  }
  let ridge = eaves + half

  if (plan.chimney) {
    let { on, at: along } = plan.chimney
    let [a, b] = span(along, m(plan.chimney.wide ?? 1.5))
    let [lo, hi] = ends(on)
    if (a <= lo || b >= hi) fail('the chimney', `the ${on} wall's corner`)
    for (let d = 0; d >= -3; d--) {
      for (let u = a; u <= b; u++) {
        let [x, z] = cell(on, u, d)
        for (let y = 0; y <= ridge + 4; y++) {
          let was = own.get(key(x, y, z))
          if (was && was != 'wall' && was != 'the roof' && y >= P) {
            fail('the chimney', was)
          }
          let rim = y == ridge + 4 && d < 0 && d > -3 && u > a && u < b
          if (rim) clear(x, y, z, 'the chimney')
          else put(x, y, z, dress.stone, 'the chimney')
        }
      }
    }
    for (let u = a - 1; u <= b + 1; u++) {
      for (let d = 1; d >= -4; d--) {
        let [x, z] = cell(on, u, d)
        if (u < a || u > b || d > 0 || d < -3) {
          put(
            x,
            ridge + 3,
            z,
            shade(color(dress.stone, x, 0, z), 0.8),
            'the chimney',
          )
        }
      }
    }
  }

  // What furnishes each storey, then whatever only this plan has.
  let place = (p: Place, f: number, outside: boolean) => {
    let face = 'on' in p ? opposite(p.on) : p.face ?? 'south'
    let v = spun(p.piece.make(dress, seed), turnOf(face))
    let lo: Vec = [1e9, 1e9, 1e9], hi: Vec = [-1e9, -1e9, -1e9]
    for (let k of v.keys()) {
      let c = unkey(k)
      for (let j = 0; j < 3; j++) {
        lo[j] = Math.min(lo[j], c[j]), hi[j] = Math.max(hi[j], c[j])
      }
    }
    let dx: number, dz: number
    if ('on' in p) {
      let [ax, az] = alongOf(p.on), [ix, iz] = inward(p.on)
      let [wx, wz] = cell(p.on, m(p.at), 1)
      // Its back to the wall, its middle `at` along it.
      let back = ix > 0 ? lo[0] : ix < 0 ? hi[0] : iz > 0 ? lo[2] : hi[2]
      dx = ax ? Math.round(p.at / S - (lo[0] + hi[0] + 1) / 2) : wx - back
      dz = az ? Math.round(p.at / S - (lo[2] + hi[2] + 1) / 2) : wz - back
    } else {
      dx = Math.round(p.at[0] / S - (lo[0] + hi[0] + 1) / 2)
      dz = Math.round(p.at[1] / S - (lo[2] + hi[2] + 1) / 2)
    }
    let name = `the ${p.piece.name}`
    for (let [k, c] of v) {
      let [x, y, z] = unkey(k)
      x += dx, y += f, z += dz
      let inside = x > x0 && x < x1 && z > z0 && z < z1
      if (outside == inside) fail(name, outside ? 'the building' : 'a wall')
      let was = own.get(key(x, y, z)) ?? room.get(key(x, y, z))
      if (was && !(was == 'floor' && y == f - 1)) fail(name, was)
      put(x, y, z, c, name)
    }
    let turn = turnOf(face)
    let to = (x: number, y: number, z: number): Vec => {
      let [a, b] = spinCell(x, z, turn)
      return at(a + dx, y + f, b + dz)
    }
    let mid = at((lo[0] + hi[0]) / 2 + dx, f, (lo[2] + hi[2]) / 2 + dz)
    let u = p.piece.use
    if (u) {
      // Room for someone to stand there: the voxel and those round it.
      let spot = to(u.at[0], 0, u.at[1])
      let [cx, cz] = [Math.floor(spot[0] / S), Math.floor(spot[2] / S)]
      for (let x = cx - 1; x <= cx + 1; x++) {
        for (let z = cz - 1; z <= cz + 1; z++) {
          for (let y = f; y < f + 7; y++) {
            let was = own.get(key(x, y, z))
            if (was) fail(`where ${name} is used`, was)
            room.set(key(x, y, z), `where ${name} is used`)
          }
        }
      }
      uses.push({
        for: u.for,
        at: spot,
        yaw: Math.atan2(mid[0] - spot[0], mid[2] - spot[2]),
      })
    }
    let g = p.piece.glow
    if (g) glows.push({ ...g, at: to(g.at[0], g.at[1], g.at[2]) })
    if (p.piece.station) stations.push({ craft: p.piece.station, at: mid })
  }
  plan.storeys.forEach((s, i) => {
    for (let p of s.furnish ?? []) place(p, floors[i], false)
  })
  plan.more?.({
    x0,
    x1,
    z0,
    z1,
    floors,
    dress,
    seed,
    cell,
    put,
    box,
    place: (piece, at, face) => place({ piece, at, face }, 0, true),
  })

  return {
    vox,
    size: S,
    at: [0, 0, 0],
    doors,
    floors: floors.map((f) => f * S),
    uses,
    glows,
    stations,
    foot: [W * S, D * S],
  }
}

let opposite = (s: Side): Side => TURNS[(turnOf(s) + 2) % 4]

/** A colour a little darker (k < 1) or lighter, of the same stuff (mesh.ts
 * `metal`). */
export let shade = (c: number, k: number) => {
  let ch = (s: number) => Math.min(255, Math.round(((c >> s) & 255) * k))
  return c - c % 0x1000000 + (ch(16) << 16 | ch(8) << 8 | ch(0))
}
