// Voxels into triangles. Every face in the vale, the ground's and a boar's
// alike, is one quad written by `quad`, carrying what the soft material
// (soft.ts) needs to round it: where on the face each corner sits and which of
// its four edges are convex (`edge`), and how wide the rounding is across the
// face and how big its voxels are (`bw`). A face's two in-plane axes follow
// one convention (`axes`), shared with the shader, so a rim flag names the
// same edge on both sides.
//
// A vertex is written as narrow as the GPU will take it, 36 bytes, since a
// level is millions of them and a phone holds them all: every attribute is 4
// bytes a vertex or a multiple, the one stride Metal (Safari's WebGL) takes
// without converting. What a face is made of, matte or metal, rides in the
// last byte of its `edge`, so saying it costs no byte more (`METAL`).
//
// `blob` meshes a small voxel model: a tree, a rock, a house. Faces alike in
// colour, rounding and shade merge into larger quads; the shader still tints
// each voxel of a merged face on its own, so the merge cannot be seen. The
// ground has its own mesher (ground.ts) because it is a heightfield, and a
// model built of boxes its own (boxes.ts).
//
// No mesher writes two faces the depth buffer cannot tell apart (`fights`):
// none in one plane, and none facing the same way closer than a step
// (`STEP`).

export type Vec = [number, number, number]

/** The triangles being written, a vertex at a time: where it is (3 numbers,
 * metres); which way its face looks (4: the normal and a 0); its colour (4:
 * sRGB bytes and 255); where on its face it sits, which of the face's edges
 * are rounded and what it is made of (4: u and v, 0 or 1, the edge flags as
 * bits, and its material); and the rounding's widths across the face and the
 * voxel edge (3). */
export type Out = {
  pos: number[]
  nrm: number[]
  col: number[]
  edge: number[]
  bw: number[]
  idx: number[]
}

export let out = (): Out => ({
  pos: [],
  nrm: [],
  col: [],
  edge: [],
  bw: [],
  idx: [],
})

// What a vertex carries besides where it is: copied as it stands.
let COPIED: ('nrm' | 'col' | 'edge' | 'bw')[] = ['nrm', 'col', 'edge', 'bw']

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

/** The compact bounds and face planes of a mesh, before it is placed. */
export type Profile = {
  room: [Vec, Vec]
  planes: [number[], number[], number[]]
}

export let profileOf = (o: Out): Profile => {
  let lo: Vec = [Infinity, Infinity, Infinity]
  let hi: Vec = [-Infinity, -Infinity, -Infinity]
  let planes: [Set<number>, Set<number>, Set<number>] = [
    new Set(),
    new Set(),
    new Set(),
  ]
  for (let i = 0; i < o.pos.length; i++) {
    let k = i % 3, m = o.pos[i]
    lo[k] = Math.min(lo[k], m)
    hi[k] = Math.max(hi[k], m)
  }
  for (let q = 0; q < o.pos.length; q += 12) {
    for (let k = 0; k < 3; k++) {
      let m = o.pos[q + k]
      if ([3, 6, 9].every((d) => Math.abs(o.pos[q + d + k] - m) < 1e-6)) {
        planes[k].add(m)
      }
    }
  }
  return {
    room: [lo, hi],
    planes: [[...planes[0]], [...planes[1]], [...planes[2]]],
  }
}

/** What a mesher wrote, in the typed arrays a GPU takes: what a worker hands
 * the page without a copy (grow.ts). */
export type Packed = {
  pos: Float32Array<ArrayBuffer>
  nrm: Int8Array<ArrayBuffer>
  col: Uint8Array<ArrayBuffer>
  edge: Uint8Array<ArrayBuffer>
  bw: Float32Array<ArrayBuffer>
  idx: Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>
}

/** Triangles packed, with indices as narrow as the vertex count allows. A
 * colour written as sRGB hex comes back as the same bytes.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { cuboids } from './boxes.ts'
 * let p = pack(cuboids(out(), [[[0, 0, 0], [1, 1, 1], 0x80c020]]))
 * assertEquals([p.pos.length / 3, p.idx.length / 3], [24, 12])
 * assertEquals(p.idx instanceof Uint16Array, true)
 * assertEquals([...p.col.slice(0, 4)], [0x80, 0xc0, 0x20, 255])
 * ```
 */
export let pack = (o: Out): Packed => ({
  pos: new Float32Array(o.pos),
  nrm: new Int8Array(o.nrm),
  col: new Uint8Array(o.col),
  edge: new Uint8Array(o.edge),
  bw: new Float32Array(o.bw),
  idx: o.pos.length / 3 > 65535
    ? new Uint32Array(o.idx)
    : new Uint16Array(o.idx),
})

/** The buffers a packed mesh is made of, to hand over rather than copy. */
export let buffers = (p: Packed): ArrayBuffer[] =>
  [p.pos, p.nrm, p.col, p.edge, p.bw, p.idx].map((a) => a.buffer)

/** The least distance two surfaces facing the same way keep apart, in metres,
 * so the depth buffer always tells which is in front: a worn layer over what
 * it covers (boxes.ts), a thing standing on the ground or in another
 * (chunks.ts). A 24-bit depth buffer parts two surfaces d metres off when
 * they are about d² / (near · 2²⁴) apart, near being the camera's near plane
 * (cam.ts `NEAR`): a millimetre at 100 m, so a step holds out to the fog. */
export let STEP = 0.005

// A face as `fights` measures it: the axis it looks along and which way, the
// plane it lies in, and its extent in that plane.
type Flat = {
  axis: number
  sign: number
  at: number
  u0: number
  v0: number
  u1: number
  v1: number
}

// Every face of a packed mesh: each quad `quad` wrote, four vertices and two
// triangles, looking the way its first triangle winds.
let facesOf = (p: Packed): Flat[] => {
  let at = (i: number, a: number) => p.pos[i * 3 + a]
  let faces: Flat[] = []
  for (let q = 0; q < p.idx.length; q += 6) {
    let [a, b, c] = [p.idx[q], p.idx[q + 1], p.idx[q + 2]]
    let e = [0, 1, 2].map((k) => at(b, k) - at(a, k))
    let f = [0, 1, 2].map((k) => at(c, k) - at(a, k))
    let n = [
      e[1] * f[2] - e[2] * f[1],
      e[2] * f[0] - e[0] * f[2],
      e[0] * f[1] - e[1] * f[0],
    ]
    let axis = [1, 2].reduce(
      (m, k) => Math.abs(n[k]) > Math.abs(n[m]) ? k : m,
      0,
    )
    let [ua, va] = axes(axis)
    let base = Math.min(...p.idx.subarray(q, q + 6))
    let us = [0, 1, 2, 3].map((i) => at(base + i, ua))
    let vs = [0, 1, 2, 3].map((i) => at(base + i, va))
    faces.push({
      axis,
      sign: Math.sign(n[axis]),
      at: at(base, axis),
      u0: Math.min(...us),
      v0: Math.min(...vs),
      u1: Math.max(...us),
      v1: Math.max(...vs),
    })
  }
  return faces
}

// How near, in metres, is as good as touching, for a packed mesh's 32-bit
// numbers.
let TOUCH = 1e-5

/** Every pair of faces in `p` the depth buffer could not tell apart, by their
 * order in it: where they overlap, two looking the same way less than a step
 * apart, or two back to back in one plane, where two solids meet and neither
 * shows. Nothing a mesher writes ever does (boxes.ts, `blob`, ground.ts).
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let white = Array(12).fill(1), plain: [0, 0, 0, 0] = [0, 0, 0, 0]
 * let floor = (y: number, sign = 1, x = 0) => {
 *   let o = out()
 *   quad(o, [x, y, 0], 1, 1, 1, sign, white, plain, 0)
 *   return o
 * }
 * let both = (a: Out, b: Out) => {
 *   let o = out()
 *   place(o, a, [0, 0, 0])
 *   place(o, b, [0, 0, 0])
 *   return fights(pack(o))
 * }
 * assertEquals(both(floor(0), floor(0.002)), [[0, 1]])
 * assertEquals(both(floor(0), floor(STEP)), [])
 * assertEquals(both(floor(0), floor(0, -1)), [[0, 1]])
 * assertEquals(both(floor(0), floor(0, 1, 1)), []) // side by side
 * ```
 */
export let fights = (p: Packed): [number, number][] => {
  let faces = facesOf(p)
  // Faces by axis and slab of planes a step deep: a pair closer than a step
  // lies in one slab or two neighbouring.
  let slabs = new Map<string, number[]>()
  for (let [i, f] of faces.entries()) {
    let k = `${f.axis} ${Math.floor(f.at / STEP)}`
    let slab = slabs.get(k)
    if (slab) slab.push(i)
    else slabs.set(k, [i])
  }
  let got: [number, number][] = []
  for (let [k, own] of slabs) {
    let [axis, n] = k.split(' ').map(Number)
    let next = slabs.get(`${axis} ${n + 1}`) ?? []
    let near = [...own, ...next].sort((a, b) => faces[a].u0 - faces[b].u0)
    let mine = new Set(own)
    for (let x = 0; x < near.length; x++) {
      let a = faces[near[x]]
      for (let y = x + 1; y < near.length; y++) {
        let b = faces[near[y]]
        if (b.u0 > a.u1 - TOUCH) break
        if (!mine.has(near[x]) && !mine.has(near[y])) continue
        if (Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0) < TOUCH) continue
        if (Math.min(a.v1, b.v1) - Math.max(a.v0, b.v0) < TOUCH) continue
        let d = Math.abs(a.at - b.at)
        if (a.sign == b.sign ? d < STEP - TOUCH : d < TOUCH) {
          got.push([Math.min(near[x], near[y]), Math.max(near[x], near[y])])
        }
      }
    }
  }
  return got.sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

/** What a face is made of, besides its colour: matte, the soft look of
 * everything in the vale, or metal, which mirrors the sky and catches the sun
 * (soft.ts). A colour carries its material in the byte above its 24 bits of
 * sRGB, so a model says what each box or voxel is made of where it says its
 * colour; the byte has room for more materials than these. */
export let MATTE = 0
export let METAL = 1

/** A colour, in metal.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals([materialOf(metal(0x9aa2aa)), materialOf(0x9aa2aa)], [
 *   METAL,
 *   MATTE,
 * ])
 * // the colour itself is the same
 * assertEquals(rgb(metal(0x9aa2aa)), rgb(0x9aa2aa))
 * ```
 */
export let metal = (hex: number) => hex % 0x1000000 + METAL * 0x1000000

/** What a colour is made of: `MATTE` or `METAL`. */
export let materialOf = (hex: number) => Math.floor(hex / 0x1000000)

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
 * metres, `ao` darkens the corners (0 dark to 3 open), `cell` is the edge of
 * the voxels it is made of, and `material` what they are made of (`METAL`).
 * The diagonal is flipped where that keeps the darkening smooth.
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
  material = MATTE,
) => {
  let [ua, va] = axes(axis)
  let base = o.pos.length / 3
  let bu = Math.min(0.5, round / du), bv = Math.min(0.5, round / dv)
  let flags = rim[0] | rim[1] << 1 | rim[2] << 2 | rim[3] << 3
  for (let i = 0; i < 4; i++) {
    let cu = i == 1 || i == 2 ? 1 : 0, cv = i >= 2 ? 1 : 0
    let p: Vec = [at[0], at[1], at[2]]
    p[ua] += cu * du
    p[va] += cv * dv
    o.pos.push(p[0], p[1], p[2])
    o.nrm.push(
      axis == 0 ? sign : 0,
      axis == 1 ? sign : 0,
      axis == 2 ? sign : 0,
      0,
    )
    let shade = AO[ao[i]]
    o.col.push(
      srgb(c[i * 3] * shade),
      srgb(c[i * 3 + 1] * shade),
      srgb(c[i * 3 + 2] * shade),
      255,
    )
    o.edge.push(cu, cv, flags, material)
    o.bw.push(bu, bv, cell)
  }
  let flip = ao[0] + ao[2] < ao[1] + ao[3]
  let t = flip ? [[0, 1, 3], [1, 2, 3]] : [[0, 1, 2], [0, 2, 3]]
  for (let [a, b, d] of t) {
    if (WINDING[axis] * sign > 0) o.idx.push(base + a, base + b, base + d)
    else o.idx.push(base + a, base + d, base + b)
  }
}

// One sRGB channel as the linear light three.js blends vertex colours in, and
// back: linear light as an sRGB byte, looked up, since a level writes
// millions (the soft shader decodes it again).
let linear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
let STEPS = 4096
let SRGB = Uint8Array.from({ length: STEPS + 1 }, (_, i) => {
  let c = i / STEPS
  return Math.round(
    255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055),
  )
})
let srgb = (c: number) =>
  SRGB[Math.max(0, Math.min(STEPS, Math.round(c * STEPS)))]

/** A colour, written as sRGB hex, as three linear numbers in [0, 1]. */
export let rgb = (hex: number): Vec => [
  linear(((hex >> 16) & 255) / 255),
  linear(((hex >> 8) & 255) / 255),
  linear((hex & 255) / 255),
]

/** A small voxel model: voxel coordinates, packed, to a colour, and what the
 * voxel is made of (`metal`). */
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
          materialOf(r.color),
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
