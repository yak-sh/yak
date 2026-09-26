// Voxels into triangles. Every face in the vale, the ground's and a boar's
// alike, is one quad written by `quad`, carrying what the soft material
// (soft.ts) needs to round it: which of its four edges are convex (`rim`),
// how wide the rounding is across the face and how big its voxels are (`bw`),
// and where on the face each corner sits (`uv`). A face's two in-plane axes
// follow one convention (`axes`), shared with the shader, so a rim flag names
// the same edge on both sides.
//
// `blob` meshes a small voxel model: a tree, a rock, a house. Faces alike in
// colour, rounding and shade merge into larger quads; the shader still tints
// each voxel of a merged face on its own, so the merge cannot be seen. The
// ground has its own mesher (ground.ts) because it is a heightfield.

export type Vec = [number, number, number]

/** The triangles being written: flat arrays, the way a BufferGeometry takes
 * them. */
export type Out = {
  pos: number[]
  nrm: number[]
  col: number[]
  uv: number[]
  rim: number[]
  bw: number[]
  idx: number[]
}

export let out = (): Out => ({
  pos: [],
  nrm: [],
  col: [],
  uv: [],
  rim: [],
  bw: [],
  idx: [],
})

// What a vertex carries besides where it is: copied as it stands.
let COPIED: ('nrm' | 'col' | 'uv' | 'rim' | 'bw')[] = [
  'nrm',
  'col',
  'uv',
  'rim',
  'bw',
]

/** Copy triangles into `into`, moved by `at`. */
export let place = (into: Out, from: Out, at: Vec) => {
  let base = into.pos.length / 3
  for (let i = 0; i < from.pos.length; i += 3) {
    into.pos.push(
      from.pos[i] + at[0],
      from.pos[i + 1] + at[1],
      from.pos[i + 2] + at[2],
    )
  }
  for (let name of COPIED) {
    let src = from[name], dst = into[name]
    for (let i = 0; i < src.length; i++) dst.push(src[i])
  }
  for (let i of from.idx) into.idx.push(i + base)
}

/** A face's two in-plane axes, by the axis its normal lies on: x → (z, y),
 * y → (x, z), z → (x, y). soft.ts derives the same pair from the normal. */
export let axes = (axis: number): [number, number] =>
  axis == 0 ? [2, 1] : axis == 1 ? [0, 2] : [0, 1]

let unit = (a: number, s = 1): Vec => {
  let v: Vec = [0, 0, 0]
  v[a] = s
  return v
}

// How much light a corner keeps, by how many of its three neighbours are open.
let AO = [0.5, 0.68, 0.84, 1]

// The sign of (u × v) along the normal's axis: which way round is outward.
let WINDING = [0, 1, 2].map((axis) => {
  let [ua, va] = axes(axis)
  let u = unit(ua), v = unit(va)
  return [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ][axis]
})

/**
 * One face: `at` its minimum corner, `du` and `dv` its extent along its two
 * axes (in metres), `sign` which way along `axis` it faces. `c` holds a colour
 * per corner (r, g, b, in corner order: at, +u, +u+v, +v). `rim` flags its
 * edges (−u, +u, −v, +v) for rounding, `round` is the rounding's width in
 * metres, `ao` darkens the corners (0 dark to 3 open), and `cell` is the edge
 * of the voxels it is made of. The diagonal is flipped where that keeps the
 * darkening smooth.
 */
export let quad = (
  o: Out,
  at: Vec,
  axis: number,
  du: number,
  dv: number,
  sign: number,
  c: number[],
  rim: [number, number, number, number],
  round: number,
  ao: [number, number, number, number] = [3, 3, 3, 3],
  cell = 0.5,
) => {
  let [ua, va] = axes(axis)
  let base = o.pos.length / 3
  let bu = Math.min(0.5, round / du), bv = Math.min(0.5, round / dv)
  for (let i = 0; i < 4; i++) {
    let cu = i == 1 || i == 2 ? 1 : 0, cv = i >= 2 ? 1 : 0
    let p: Vec = [at[0], at[1], at[2]]
    p[ua] += cu * du
    p[va] += cv * dv
    o.pos.push(p[0], p[1], p[2])
    o.nrm.push(axis == 0 ? sign : 0, axis == 1 ? sign : 0, axis == 2 ? sign : 0)
    let shade = AO[ao[i]]
    o.col.push(c[i * 3] * shade, c[i * 3 + 1] * shade, c[i * 3 + 2] * shade)
    o.uv.push(cu, cv)
    o.rim.push(rim[0], rim[1], rim[2], rim[3])
    o.bw.push(bu, bv, cell)
  }
  let flip = ao[0] + ao[2] < ao[1] + ao[3]
  let t = flip ? [[0, 1, 3], [1, 2, 3]] : [[0, 1, 2], [0, 2, 3]]
  for (let [a, b, d] of t) {
    if (WINDING[axis] * sign > 0) o.idx.push(base + a, base + b, base + d)
    else o.idx.push(base + a, base + d, base + b)
  }
}

// One sRGB channel as the linear light three.js blends vertex colours in.
let linear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4

/** A colour, written as sRGB hex, as three linear numbers in [0, 1]. */
export let rgb = (hex: number): Vec => [
  linear(((hex >> 16) & 255) / 255),
  linear(((hex >> 8) & 255) / 255),
  linear((hex & 255) / 255),
]

/** A box, soft on every edge: `min` its lowest corner and `size` its extent,
 * in metres, drawn as if built of voxels `cell` across. The part a figure is
 * made of (figures.ts). */
export let cuboid = (
  o: Out,
  min: Vec,
  size: Vec,
  hex: number,
  cell = 0.1,
  round = 0.035,
) => {
  let c = rgb(hex)
  let cs = [...c, ...c, ...c, ...c]
  for (let axis = 0; axis < 3; axis++) {
    let [ua, va] = axes(axis)
    for (let sign of [-1, 1]) {
      let at: Vec = [min[0], min[1], min[2]]
      if (sign > 0) at[axis] += size[axis]
      quad(
        o,
        at,
        axis,
        size[ua],
        size[va],
        sign,
        cs,
        [1, 1, 1, 1],
        round,
        undefined,
        cell,
      )
    }
  }
  return o
}

/** A small voxel model: voxel coordinates, packed, to a colour. */
export type Vox = Map<number, number>

let B = 512
/** Coordinates in [−512, 512) as one key. */
export let key = (x: number, y: number, z: number) =>
  ((x + B) * 1024 + (y + B)) * 1024 + (z + B)

/** A key's coordinates. */
export let unkey = (k: number): Vec => [
  Math.floor(k / 1048576) - B,
  (Math.floor(k / 1024) % 1024) - B,
  (k % 1024) - B,
]

/** Fill a box of voxels, corners inclusive. */
export let box = (
  v: Vox,
  [x0, y0, z0]: Vec,
  [x1, y1, z1]: Vec,
  color: number,
) => {
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) v.set(key(x, y, z), color)
    }
  }
  return v
}

/** Fill a ball of voxels, with `pick` choosing each one's colour (or none),
 * given its coordinates. */
export let ball = (
  v: Vox,
  [cx, cy, cz]: Vec,
  r: number,
  pick: (x: number, y: number, z: number) => number | null,
) => {
  let R = Math.ceil(r)
  for (let x = -R; x <= R; x++) {
    for (let y = -R; y <= R; y++) {
      for (let z = -R; z <= R; z++) {
        if (x * x + y * y + z * z > r * r) continue
        let c = pick(cx + x, cy + y, cz + z)
        if (c != null) v.set(key(cx + x, cy + y, cz + z), c)
      }
    }
  }
  return v
}

// One exposed voxel face, before merging: where it lies in its plane, and
// everything that must match for two faces to merge.
type Face = { u: number; v: number; color: number; rim: number; ao: number }

/**
 * Mesh a voxel model into `o`: voxel `size`, placed with its origin at `at`.
 * Every exposed face is rounded along each edge that is convex; faces alike
 * in colour, rounding and shade merge into rectangles.
 */
export let blob = (
  o: Out,
  v: Vox,
  size: number,
  at: Vec = [0, 0, 0],
  round = 0.22,
) => {
  let solid = (p: Vec) => v.has(key(p[0], p[1], p[2]))
  // Faces by plane: axis, sign and depth.
  let planes = new Map<string, Map<number, Face>>()
  for (let [k, color] of v) {
    let p = unkey(k)
    for (let axis = 0; axis < 3; axis++) {
      let [ua, va] = axes(axis)
      for (let sign of [-1, 1]) {
        let q: Vec = [p[0], p[1], p[2]]
        q[axis] += sign
        if (solid(q)) continue
        // What stands on the ground never shows its underside.
        if (axis == 1 && sign < 0 && p[1] == 0) continue
        let step = (from: Vec, a: number, s: number): Vec => {
          let r: Vec = [from[0], from[1], from[2]]
          r[a] += s
          return r
        }
        // An edge is convex where the voxel beyond it, and the one diagonally
        // out past it, are both empty.
        let open = (a: number, s: number) =>
          !solid(step(p, a, s)) && !solid(step(q, a, s)) ? 1 : 0
        let rim = open(ua, -1) | open(ua, 1) << 1 | open(va, -1) << 2 |
          open(va, 1) << 3
        // Ambient occlusion from the voxels just outside the face.
        let occ = (su: number, sv: number) => {
          let a = step(q, ua, su), b = step(q, va, sv)
          let s1 = solid(a) ? 1 : 0, s2 = solid(b) ? 1 : 0
          return s1 && s2 ? 0 : 3 - (s1 + s2 + (solid(step(a, va, sv)) ? 1 : 0))
        }
        let ao = occ(-1, -1) | occ(1, -1) << 2 | occ(1, 1) << 4 |
          occ(-1, 1) << 6
        let plane = `${axis} ${sign} ${p[axis]}`
        if (!planes.has(plane)) planes.set(plane, new Map())
        planes.get(plane)!.set(p[ua] * 4096 + p[va], {
          u: p[ua],
          v: p[va],
          color,
          rim,
          ao,
        })
      }
    }
  }
  for (let [plane, faces] of planes) {
    let [axis, sign, depth] = plane.split(' ').map(Number)
    let [ua, va] = axes(axis)
    // Runs along u: neighbouring faces alike in colour, shade and their
    // rounding across the run. Inside a run no edge is convex (each face's
    // neighbour is there), so a run's own ends say its rounding along u.
    let runs = new Map<number, Run[]>()
    let rows = new Map<number, Face[]>()
    for (let f of faces.values()) {
      if (!rows.has(f.v)) rows.set(f.v, [])
      rows.get(f.v)!.push(f)
    }
    for (let [row, cells] of rows) {
      cells.sort((a, b) => a.u - b.u)
      let out: Run[] = []
      for (let f of cells) {
        let last = out[out.length - 1]
        if (
          last && last.u + last.w == f.u && last.color == f.color &&
          last.ao == f.ao && last.across == (f.rim & 12)
        ) {
          last.w++
          last.end = (f.rim >> 1) & 1
        } else {
          out.push({
            u: f.u,
            w: 1,
            color: f.color,
            ao: f.ao,
            across: f.rim & 12,
            start: f.rim & 1,
            end: (f.rim >> 1) & 1,
            used: false,
          })
        }
      }
      runs.set(row, out)
    }
    // Stack runs of one span into rectangles along v.
    let order = [...runs.keys()].sort((a, b) => a - b)
    for (let row of order) {
      for (let r of runs.get(row)!) {
        if (r.used) continue
        r.used = true
        let h = 1, top = r
        for (;;) {
          let next = runs.get(row + h)?.find((n) =>
            !n.used && n.u == r.u && n.w == r.w && n.color == r.color &&
            n.ao == r.ao && n.start == r.start && n.end == r.end
          )
          if (!next) break
          next.used = true
          top = next
          h++
        }
        let min: Vec = [0, 0, 0]
        min[axis] = depth + (sign > 0 ? 1 : 0)
        min[ua] = r.u
        min[va] = row
        let c = rgb(r.color)
        quad(
          o,
          [at[0] + min[0] * size, at[1] + min[1] * size, at[2] + min[2] * size],
          axis,
          r.w * size,
          h * size,
          sign,
          [...c, ...c, ...c, ...c],
          [r.start, r.end, (r.across >> 2) & 1, (top.across >> 3) & 1],
          size * round,
          [r.ao & 3, (r.ao >> 2) & 3, (r.ao >> 4) & 3, (r.ao >> 6) & 3],
          size,
        )
      }
    }
  }
  return o
}

// A run of alike faces along u, and how it is rounded: `across` holds the
// rounding of its edges along v (the −v and +v bits), `start` and `end` its
// two ends'.
type Run = {
  u: number
  w: number
  color: number
  ao: number
  across: number
  start: number
  end: number
  used: boolean
}
