// One-time export (T-61627): every creature's look, drawn by its body plan's
// code in bodies/, becomes a figure row (figure.ts), so it draws as it did.
// Each plan names its parts and gives each its role (parts.ts `tag`) and
// keeps how it moves on its root (`userData.moves`); this reads the bone
// tree at true size (the look's scale folded into the boxes) and writes
// seed/figures/<land>.json beside seed/beasts/. With --check it also builds
// each creature both ways and reports how far apart the two draw and move.
//
//   deno run -A apps/vale/export-figures.ts [--check]
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import type { Box } from './boxes.ts'
import { type Beast, BEASTS } from './beasts.ts'
import { beast, type Puppet } from './figures.ts'
import { type Figure, type Part, puppet } from './figure.ts'
import type { Vec } from './mesh.ts'
import type { Moves } from './parts.ts'
import { uuidOf } from './rand.ts'
import { seedDesigns } from './designs_fixture.ts'

seedDesigns()

let r4 = (n: number) => Math.round(n * 1e4) / 1e4 + 0
let vec = (v: { x: number; y: number; z: number }): Vec => [
  r4(v.x),
  r4(v.y),
  r4(v.z),
]

// A part's boxes at `k` times their size.
let sized = (boxes: Box[], k: number): Box[] =>
  boxes.map(([[x, y, z], [w, h, d], c, round]) => {
    let b: Box = [[r4(x * k), r4(y * k), r4(z * k)], [
      r4(w * k),
      r4(h * k),
      r4(d * k),
    ], c]
    if (round != undefined || Math.abs(k - 1) > 1e-9) {
      b.push(r4((round ?? 0.035) * k))
    }
    return b
  })

let unscaled = (m: THREE.Matrix4) => {
  let t = new THREE.Vector3(), q = new THREE.Quaternion()
  m.decompose(t, q, new THREE.Vector3())
  return new THREE.Matrix4().compose(t, q, new THREE.Vector3(1, 1, 1))
}

/** The figure a creature's body plan draws (figures.ts `beast`), at its
 * look's scale. */
export let exported = (eid: string, b: Beast, made: Puppet): Figure => {
  made.root.updateMatrixWorld(true)
  let bones: THREE.Bone[] = []
  made.root.traverse((o) => {
    if (o instanceof THREE.Bone && o.userData.boxes) bones.push(o)
  })
  let names = new Set<string>()
  let parts = bones.map((bone): Part => {
    if (!bone.name || names.has(bone.name)) {
      throw new Error(`${b.name}: a part named '${bone.name}' twice or none`)
    }
    names.add(bone.name)
    let up = bone.parent
    while (up && !(up instanceof THREE.Bone && up.userData.boxes)) {
      up = up.parent
    }
    let s = new THREE.Vector3()
    bone.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), s)
    if (Math.abs(s.x - s.y) + Math.abs(s.y - s.z) > 1e-6) {
      throw new Error(`${b.name}: ${bone.name} is not scaled evenly`)
    }
    let frame = up ? unscaled(up.matrixWorld) : new THREE.Matrix4()
    let local = frame.invert().multiply(unscaled(bone.matrixWorld))
    let t = new THREE.Vector3(), q = new THREE.Quaternion()
    local.decompose(t, q, new THREE.Vector3())
    let e = new THREE.Euler().setFromQuaternion(q, 'YXZ')
    let part = { name: bone.name } as Part
    if (up) part.parent = up.name
    part.pivot = vec(t)
    let turn = vec(e)
    if (turn.some((a) => a != 0)) part.turn = turn
    let cell = r4((bone.userData.cell ?? 0.1) * s.x)
    if (cell != 0.1) part.cell = cell
    part.boxes = sized(bone.userData.boxes, s.x)
    if (bone.userData.move) part.move = bone.userData.move
    return part
  })
  let moves = made.root.userData.moves as Moves
  return {
    of: eid,
    parts,
    height: r4(made.height),
    size: b.size,
    dust: b.dust,
    ...moves,
  }
}

// JSON a person can read: two-space indents, and a point, a box or a role
// on one line.
let depth = (v: unknown): number =>
  v && typeof v == 'object'
    ? 1 + Math.max(0, ...Object.values(v).map(depth))
    : 0
let json = (v: unknown, pad = ''): string => {
  if (depth(v) <= 2) {
    return JSON.stringify(v).replaceAll(',', ', ').replaceAll('":', '": ')
  }
  let inner = pad + '  '
  if (Array.isArray(v)) {
    return `[\n${v.map((x) => inner + json(x, inner)).join(',\n')}\n${pad}]`
  }
  let e = Object.entries(v as object)
  return `{\n${
    e.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${json(x, inner)}`)
      .join(',\n')
  }\n${pad}}`
}
let written = (rows: unknown[]) => json(rows) + '\n'

if (import.meta.main) await main()

async function main() {
  // Every creature's eid and kind, by the land its seed file is named for.
  type Row = { entity: { eid: string }; beast_design: { kind: string } }
  let lands = [
    'meadow',
    'woods',
    'waters',
    'heights',
    'deep',
    'sands',
    'frost',
    'fire',
  ]
  let figures = new Map<string, Figure>()
  for (let land of lands) {
    let list: Row[] = JSON.parse(
      await Deno.readTextFile(
        new URL(`./seed/beasts/${land}.json`, import.meta.url),
      ),
    )
    let out = list.map(({ entity: { eid }, beast_design: { kind } }) => {
      let f = exported(eid, BEASTS[kind], beast(kind))
      figures.set(kind, f)
      return { entity: { eid: uuidOf(`figure/${eid}`) }, figure: f }
    })
    if (!Deno.args.includes('--check')) {
      await Deno.mkdir(new URL('./seed/figures/', import.meta.url), {
        recursive: true,
      })
      await Deno.writeTextFile(
        new URL(`./seed/figures/${land}.json`, import.meta.url),
        written(out),
      )
    }
  }

  if (Deno.args.includes('--check')) {
    // Where each part's drawn corners lie in the world, part by part.
    let corners = (p: Puppet) => {
      p.root.updateMatrixWorld(true)
      let out: number[][] = []
      p.root.traverse((o) => {
        if (!(o instanceof THREE.Bone && o.userData.part)) return
        let pos: number[] = o.userData.part.pos, v = new THREE.Vector3()
        let pts: number[] = []
        for (let i = 0; i < pos.length; i += 3) {
          v.fromArray(pos, i).applyMatrix4(o.matrixWorld)
          pts.push(v.x, v.y, v.z)
        }
        out.push(pts)
      })
      return out
    }
    // How far apart two drawings of a part lie: the most any side of the box
    // round its points moved.
    let edges = (pts: number[]) => {
      let lo = [Infinity, Infinity, Infinity],
        hi = [-Infinity, -Infinity, -Infinity]
      for (let i = 0; i < pts.length; i++) {
        lo[i % 3] = Math.min(lo[i % 3], pts[i])
        hi[i % 3] = Math.max(hi[i % 3], pts[i])
      }
      return [...lo, ...hi]
    }
    let far = (a: number[][], b: number[][]) => {
      if (a.length != b.length) return Infinity
      let worst = 0
      for (let [i, pa] of a.entries()) {
        let ea = edges(pa), eb = edges(b[i])
        for (let j = 0; j < 6; j++) {
          worst = Math.max(worst, Math.abs(ea[j] - eb[j]))
        }
      }
      return worst
    }
    // Each part's middle in the world, as posed.
    let middles = (p: Puppet) => {
      p.root.updateMatrixWorld(true)
      let out: THREE.Vector3[] = []
      p.root.traverse((o) => {
        if (!(o instanceof THREE.Bone && o.userData.part)) return
        let pos: number[] = o.userData.part.pos, c = new THREE.Vector3()
        for (let i = 0; i < pos.length; i += 3) {
          c.x += pos[i]
          c.y += pos[i + 1]
          c.z += pos[i + 2]
        }
        out.push(c.multiplyScalar(3 / pos.length).applyMatrix4(o.matrixWorld))
      })
      return out
    }
    let random = Math.random
    Math.random = () => 0
    let report: Record<string, string[]> = {}
    for (let [kind, f] of figures) {
      let k = BEASTS[kind].look.scale ?? 1
      let old = beast(kind), now = puppet(f)
      let draw = far(corners(old), corners(now))
      let box = new THREE.Box3(), v = new THREE.Vector3()
      for (let pts of corners(now)) {
        for (let i = 0; i < pts.length; i += 3) {
          box.expandByPoint(v.fromArray(pts, i))
        }
      }
      let sz = box.getSize(new THREE.Vector3())
      let bulk = Math.cbrt(sz.x * sz.y * sz.z)
      let worst: Record<string, number> = {}
      let acts = {
        idle: (t: number) => ({ speed: 0, swing: -1, down: false, t }),
        walk: (t: number) => ({ speed: 3, swing: -1, down: false, t }),
        bite: (t: number) => ({ speed: 0, swing: t % 1, down: false, t }),
        down: (t: number) => ({ speed: 0, swing: -1, down: true, t }),
      }
      // How far each part's middle sweeps over each act, old against new:
      // the most any part sweeps more or less along any axis, in hundredths
      // of the figure's height, signed by which sweeps further.
      for (let [name, act] of Object.entries(acts)) {
        let lo: THREE.Box3[][] = [[], []]
        for (let i = 0; i < 80; i++) {
          let t = i * 0.05
          let a = { air: false, hurt: 0, roll: -1, ...act(t) }
          old.animate(a, 0.05)
          now.animate(a, 0.05)
          for (let [w, p] of [old, now].entries()) {
            for (let [j, v] of middles(p).entries()) {
              ;(lo[w][j] ??= new THREE.Box3()).expandByPoint(v)
            }
          }
        }
        let w = 0
        for (let [j, b] of lo[0].entries()) {
          let so = b.getSize(new THREE.Vector3())
          let sn = lo[1][j].getSize(new THREE.Vector3())
          for (let ax of ['x', 'y', 'z'] as const) {
            let d = sn[ax] - so[ax]
            if (Math.abs(d) > Math.abs(w)) w = d
          }
        }
        worst[name] = Math.round(w / f.height * 100)
      }
      let plan = BEASTS[kind].look.plan
      ;(report[plan] ??= []).push(
        `${kind} k=${k} bulk/k=${(bulk / k).toFixed(2)} draw=${
          draw.toFixed(4)
        } moves(%h)=${
          Object.entries(worst).map(([a, n]) => `${a}:${n}`).join(' ')
        }`,
      )
    }
    Math.random = random
    for (let [plan, lines] of Object.entries(report)) {
      console.log(plan)
      for (let l of lines) console.log('  ' + l)
    }
  }
}
