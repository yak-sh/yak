// A creature's look as data, and the one animator that moves it. A figure is
// a jointed tree of parts, each a few soft boxes (boxes.ts) turning about a
// pivot in its parent's space, authored at its true size in metres, standing
// on the ground under its root and facing +z. Each part says the role it
// plays as the figure moves (`Move`), and the figure says how the whole goes
// over the ground (`gait`), strikes (`bite`) and falls (`fall`). The animator
// poses any figure from those alone, so a new creature is a new row, never
// new code (D-61621).
//
// A figure is drawn as one skinned mesh, its parts the bones (parts.ts
// `knit`). Every frame each part starts from its rest pose (`pivot`, `turn`)
// and its role moves it from there. How far it sways, bobs and lunges is
// measured by its bulk, so a figure twice the size moves twice as far.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import type { Box } from './boxes.ts'
import { comp } from './bundle.ts'
import type { Act, Puppet } from './figures.ts'
import type { Vec } from './mesh.ts'
import type { Bundle } from './net.ts'
import { knit, lunge, partOf } from './parts.ts'
import { flash, soft } from './soft.ts'

/** How the whole moves over the ground: striding on its legs, bounding,
 * hanging in the air on beating wings, sliding on its belly, or floating. */
export type Gait = 'walk' | 'hop' | 'hover' | 'slide' | 'drift'

/** How it strikes: its body lunges and its head tosses (lunge), its head
 * stabs down (peck), its arms come down overhead (smash), its head rears and
 * drives forward with its body following (thrust), it swoops from the air
 * (dive), it springs (leap), or it swells with light (flare). */
export type Bite =
  | 'lunge'
  | 'peck'
  | 'smash'
  | 'thrust'
  | 'dive'
  | 'leap'
  | 'flare'

/** How it falls: over onto its side, onto its back with its legs in the air,
 * back flat out as a person falls, or squashed into the ground. */
export type Fall = 'topple' | 'flip' | 'back' | 'flatten'

type None = Record<string, never>

/** A part's role as the figure moves.
 * - `leg`: strides as it walks, a leg of `phase` 0.5 half a step after one
 *   of 0; kicks back (0) or reaches forward (0.5) as it hops; sweeps as it
 *   slides. A leg hung from a leg bends at the knee.
 * - `arm`: swings as it walks and comes down in a smash, with whatever hangs
 *   from it. An arm hung from an arm bends at the elbow.
 * - `wing`: beats `beat` times a second as it hovers; on the ground it rests
 *   as posed and opens as it pecks.
 * - `tail`: wags; one curled up over the back (a sting) strikes as it bites.
 * - `head`: looks about, dips now and then, and strikes as its bite says.
 * - `jaw`: claws or mandibles, which open wide as it strikes.
 * - `spin`: turns over and over, and swells as it flares; what hangs from it
 *   wheels about with it.
 * - `link`: the `n`th length of a serpent's body behind its head, from 1,
 *   swaying on a wave that runs down it. */
export type Move =
  | { leg: { phase: number } }
  | { arm: { phase: number } }
  | { wing: { beat: number } }
  | { tail: None }
  | { head: None }
  | { jaw: None }
  | { spin: None }
  | { link: { n: number } }

/** A part: soft boxes turning about `pivot`, in the space of the part it
 * hangs from (`parent`, by name) or of the figure, turned `turn` radians
 * (y, then x, then z) at rest, its colour speckled in voxels of edge `cell`. */
export type Part = {
  name: string
  parent?: string
  pivot: Vec
  turn?: Vec
  cell?: number
  boxes: Box[]
  move?: Move
}

/** A creature's figure: what it draws (`of`, the creature), its parts, where
 * its name plate sits (`height`), how big the game takes it to be (`size`,
 * for hits and footfalls), the colour of the dust a blow knocks off it, how
 * it moves, and how its stuff looks: `speckle` its grain, `glow` the colour
 * it shines by its own light. */
export type Figure = {
  of: string
  parts: Part[]
  height: number
  size: number
  dust: number
  gait: Gait
  bite: Bite
  fall: Fall
  speckle?: number
  glow?: number
}

/** Every creature's figure, by the creature's eid. */
export let FIGURES: Record<string, Figure> = {}

let installed: Bundle[] | undefined

/** Install the store's current figures. A creature drawn twice keeps the
 * last row. The same rows again keep the index. */
export let useFigures = (rows: Bundle[]) => {
  if (rows == installed) return
  installed = rows
  FIGURES = Object.fromEntries(rows.flatMap((row) => {
    let f = comp(row, 'figure') as Figure
    return typeof f.of == 'string' ? [[f.of, f]] : []
  }))
}

let TAU = Math.PI * 2

type Role = keyof { [K in Move as keyof K]: 0 }

// A part as the animator holds it: its bone, its rest pose, its role and
// what goes with it, which side of the middle it is on, whether it hangs
// from a part of its own role (a shin from a thigh, a forearm from an arm),
// and how a tail lies: trailing behind, hanging below, or curled up over the
// back.
type Held = {
  bone: THREE.Bone
  pivot: THREE.Vector3
  turn: THREE.Euler
  role?: Role
  phase: number
  beat: number
  n: number
  side: number
  below: boolean
  lies: 'trails' | 'hangs' | 'curls'
  /** for an arm, whether something hangs from it that has no role: a club */
  holds: boolean
}

let roleOf = (m?: Move): Role | undefined =>
  m ? Object.keys(m)[0] as Role : undefined

let param = (m: Move | undefined, k: string) =>
  m ? (Object.values(m)[0] as Record<string, number>)[k] ?? 0 : 0

// The corners of a box.
let corners = (b: THREE.Box3) =>
  Array.from({ length: 8 }, (_, k) =>
    new THREE.Vector3(
      k & 1 ? b.max.x : b.min.x,
      k & 2 ? b.max.y : b.min.y,
      k & 4 ? b.max.z : b.min.z,
    ))

// Where the boxes of `parts` lie as the figure stands, in its space.
let bounds = (parts: { bone: THREE.Bone; boxes: Box[] }[]) => {
  let b = new THREE.Box3()
  for (let { bone, boxes } of parts) {
    for (let [lo, size] of boxes) {
      let one = new THREE.Box3().setFromArray([
        ...lo,
        ...lo.map((x, i) => x + size[i]),
      ])
      for (let c of corners(one)) {
        b.expandByPoint(c.applyMatrix4(bone.matrixWorld))
      }
    }
  }
  return b
}

// How each fall turns and squashes the body.
let FALLS: Record<Fall, (body: THREE.Object3D) => void> = {
  topple: (b) => b.rotation.set(0, 0, Math.PI / 2),
  flip: (b) => b.rotation.set(0, 0, Math.PI),
  back: (b) => b.rotation.set(-Math.PI / 2 + 0.1, 0, 0),
  flatten: (b) => b.scale.set(1.4, 0.2, 1.4),
}

// How high a body fallen about `at` stands for its lowest point to touch the
// ground, from where its boxes lie standing (`box`).
let lift = (fall: Fall, box: THREE.Box3, at: THREE.Vector3) => {
  let o = new THREE.Object3D()
  FALLS[fall](o)
  o.updateMatrix()
  return -Math.min(
    ...corners(box).map((c) => c.sub(at).applyMatrix4(o.matrix).y),
  )
}

/** A figure made up to be drawn and moved: its parts knitted into one
 * skinned mesh, posed every frame from what it is doing.
 *
 * ```ts
 * import { assertAlmostEquals, assertEquals } from '@std/assert'
 * import type { Box } from './boxes.ts'
 * let leg = (name: string, x: number, phase: number) => ({
 *   name, pivot: [x, 0.4, 0] as [number, number, number],
 *   boxes: [[[-0.05, -0.4, -0.05], [0.1, 0.42, 0.1], 0x604830]] as Box[],
 *   move: { leg: { phase } },
 * })
 * let p = puppet({
 *   of: 'x', height: 1, size: 1, dust: 0, gait: 'walk', bite: 'lunge',
 *   fall: 'topple',
 *   parts: [
 *     { name: 'trunk', pivot: [0, 0.4, 0], boxes: [[[-0.2, 0, -0.4], [0.4, 0.3, 0.8], 0x806040]] },
 *     leg('left', -0.12, 0), leg('right', 0.12, 0.5),
 *   ],
 * })
 * let act = { speed: 3, air: false, swing: -1, hurt: 0, roll: -1, down: false, t: 1 }
 * p.animate(act, 0.1)
 * let [l, r] = ['left', 'right'].map((n) => p.root.getObjectByName(n)!)
 * // The legs stride half a step apart.
 * assertAlmostEquals(l.rotation.x, -r.rotation.x, 1e-9)
 * // Fallen, it lies on its side, its flank on the ground.
 * p.animate({ ...act, down: true }, 0.1)
 * assertEquals(p.root.children[0].rotation.z, Math.PI / 2)
 * assertAlmostEquals(p.root.children[0].position.y, 0.2)
 * ```
 */
export let puppet = (f: Figure): Puppet => {
  let m = soft({ speckle: f.speckle ?? 0.1 })
  if (f.glow != undefined && m instanceof THREE.MeshLambertMaterial) {
    m.emissive.setHex(f.glow)
    m.emissiveIntensity = 0.7
  }
  // The body turns about `at`: the ground under it, or the middle of one in
  // the air. What it holds is set back by as much, so at rest it is where
  // its parts say.
  let root = new THREE.Group()
  let body = new THREE.Group()
  let inner = new THREE.Group()
  root.add(body)
  body.add(inner)
  let bones = new Map<string, THREE.Bone>()
  let made = f.parts.map((p) => {
    let bone = partOf(p.boxes, p.pivot, p.cell)
    bone.name = p.name
    bone.rotation.order = 'YXZ'
    if (p.turn) bone.rotation.set(...p.turn)
    ;(bones.get(p.parent ?? '') ?? inner).add(bone)
    bones.set(p.name, bone)
    return { bone, boxes: p.boxes }
  })
  knit(root, m)
  root.updateMatrixWorld(true)
  let box = bounds(made)
  let grounded = f.gait != 'hover' && f.gait != 'drift'
  let at = grounded
    ? new THREE.Vector3()
    : box.getCenter(new THREE.Vector3()).setX(0)
  inner.position.copy(at).negate()
  // Which parts hang below which, for an arm that holds something.
  let above = (name?: string): string[] => {
    let p = f.parts.find((q) => q.name == name)
    return p ? [p.name, ...above(p.parent)] : []
  }
  let held = new Set(
    f.parts.filter((p) => !p.move).flatMap((p) => above(p.parent)),
  )
  let v = new THREE.Vector3()
  let parts: Held[] = f.parts.map((p, i) => {
    let bone = made[i].bone, role = roleOf(p.move)
    let c = new THREE.Vector3()
    for (let [[x, y, z], [w, h, d]] of p.boxes) {
      c.add(v.set(x + w / 2, y + h / 2, z + d / 2))
    }
    return {
      bone,
      pivot: bone.position.clone(),
      turn: bone.rotation.clone(),
      role,
      phase: param(p.move, 'phase'),
      beat: param(p.move, 'beat'),
      n: param(p.move, 'n'),
      side: Math.sign(bone.getWorldPosition(v).x) || 1,
      below: !!p.parent &&
        roleOf(f.parts.find((q) => q.name == p.parent)?.move) == role,
      lies: Math.abs(c.y) <= Math.abs(c.z)
        ? 'trails'
        : c.y < 0
        ? 'hangs'
        : 'curls',
      holds: held.has(p.name),
    }
  })
  let of = (r: Role) => parts.filter((h) => h.role == r)
  let legs = of('leg'), arms = of('arm'), wings = of('wing'), tails = of('tail')
  let heads = of('head'), jaws = of('jaw'), spins = of('spin')
  let links = of('link')
  let holding = arms.some((r) => r.holds)
  // Its bulk, in metres: what its sways, bobs and lunges are measured by.
  let size = box.getSize(new THREE.Vector3())
  let bulk = Math.cbrt(size.x * size.y * size.z)
  // How high its hips stand, which sets how quickly it steps.
  let hips = legs.filter((l) => !l.below)
  let hip = hips.length
    ? hips.reduce((s, l) => s + l.bone.getWorldPosition(v).y, 0) / hips.length
    : 0.42
  // How high its lowest point hangs in the air, and how high it lies fallen:
  // on its body, the parts with no role, while its limbs give way.
  let air = Math.max(0, box.min.y)
  let trunk = made.filter((_, i) => !f.parts[i].move)
  let low = lift(f.fall, trunk.length ? bounds(trunk) : box, at)
  let phase = Math.random() * 6, seed = Math.random() * 6

  // How it goes over the ground at its speed, `dt` seconds on.
  let GAITS: Record<Gait, (a: Act, dt: number) => void> = {
    walk: (a, dt) => {
      phase += dt * (1.5 + 2.6 * a.speed) *
        Math.sqrt(0.42 / Math.max(hip, 0.05))
      let amp = Math.min(1, a.speed / 3.5) * 0.7
      for (let l of legs) {
        let w = phase + TAU * l.phase
        l.bone.rotation.x += l.below
          ? Math.max(0, -Math.cos(w)) * amp * 1.5
          : Math.sin(w) * amp
      }
      for (let r of arms) {
        r.bone.rotation.x += r.below
          ? -amp * 0.3
          : Math.sin(phase + TAU * r.phase) * amp * 0.8
      }
      for (let h of heads) {
        h.bone.position.z += Math.sin(phase * 2) * 0.03 * amp * bulk
      }
      body.position.y += Math.abs(Math.cos(phase)) * 0.045 * amp * bulk
      body.rotation.z = Math.sin(phase) * 0.04 * amp
    },
    hop: (a, dt) => {
      let moving = a.speed > 0.2
      phase += dt * (moving ? 6 + a.speed : 2)
      let hop = moving ? Math.max(0, Math.sin(phase)) : 0
      body.position.y += hop * 0.5 * bulk
      for (let l of legs) {
        l.bone.rotation.x += hop * 0.75 * Math.cos(TAU * l.phase)
      }
      if (legs.length) {
        body.rotation.x = hop > 0 ? -Math.cos(phase) * 0.25 : 0
        return
      }
      // With no legs to spring on, it squashes and stretches.
      let k = moving
        ? 1 - Math.max(0, -Math.sin(phase)) * 0.25 + hop * 0.12
        : 1 + Math.sin(phase) * 0.04
      body.scale.set(1 / Math.sqrt(k), k, 1 / Math.sqrt(k))
    },
    hover: (a) => {
      body.position.x += Math.sin(a.t * 1.7 + seed) * 0.08 * bulk
      body.position.y += Math.sin(a.t * 2.4 + seed) * 0.1 * bulk
      body.rotation.x = Math.min(1, a.speed / 3) * 0.22
      for (let w of wings) {
        w.bone.rotation.z += w.side * 0.75 *
          Math.sin(a.t * TAU * w.beat + seed)
      }
    },
    slide: (a, dt) => {
      let move = Math.min(1, a.speed / 2.2)
      phase += dt * (1.3 + a.speed * 3.1)
      let s = Math.sin(phase), c = Math.cos(phase)
      // A body with no lengths to carry the wave rolls as it goes.
      if (!links.length) {
        body.position.y += move * (0.02 + 0.03 * c * c) * bulk
        body.position.z += s * 0.03 * move * bulk
        body.rotation.set(c * 0.08 * move, s * 0.08 * move, 0)
      }
      for (let l of legs) {
        l.bone.rotation.y += l.side * 0.3 * move *
          Math.sin(phase + TAU * l.phase)
      }
      // A wave runs down its body, wider as it hurries, and its head sways
      // ahead of it.
      let sway = 0.05 + Math.min(1, a.speed / 2.5) * 0.12
      let wide = sway * bulk * 1.4
      for (let l of links) {
        let i = l.n - 1, w = phase - i * 0.9
        l.bone.position.x += Math.sin(w) * wide * (1 + i * 0.15)
        l.bone.rotation.y += Math.cos(w) * sway * 1.6
      }
      for (let h of heads) {
        if (links.length) {
          h.bone.position.x += Math.sin(phase + 0.9) * wide * 0.6
        } else h.bone.rotation.x += c * 0.1 * move
      }
    },
    drift: (a, dt) => {
      phase += dt * (1.5 + a.speed * 0.8)
      body.position.y += Math.sin(a.t * 1.8 + seed) * 0.12 * bulk
    },
  }

  // How it strikes, `swing` of the way through.
  let BITES: Record<Bite, (swing: number) => void> = {
    lunge: (swing) => {
      let up = lunge(swing)
      body.position.z += up * 0.24 * bulk
      body.rotation.x -= up * 0.1
      for (let h of heads) h.bone.rotation.x -= up * 0.6
    },
    peck: (swing) => {
      let up = lunge(swing)
      for (let h of heads) {
        h.bone.position.z += up * 0.18 * bulk
        h.bone.rotation.x += up * 0.7
      }
      for (let w of wings) {
        let r = w.bone.rotation
        r.set(
          r.x * (1 - up),
          r.y * (1 - up),
          r.z * (1 - up) + w.side * up * 0.5,
        )
      }
    },
    smash: (swing) => {
      // What is held comes down overhead; with nothing held, both fists.
      let up = lunge(swing, 0.45)
      for (let r of arms) {
        let x = r.below ? -up * 1.1 : 0.4 - up * 3
        if (holding && !r.holds) x = r.below ? 0 : -0.3
        r.bone.rotation.x = r.turn.x + x
      }
      body.rotation.x -= up * 0.2
    },
    thrust: (swing) => {
      let up = lunge(swing, 0.5)
      for (let h of heads) {
        h.bone.position.y += up * 0.45 * bulk
        h.bone.position.z += up * 0.5 * bulk
        h.bone.rotation.x += up * 0.8
      }
      for (let l of links) {
        l.bone.position.z += up * 0.5 * bulk * Math.max(0, 1 - (l.n - 1) / 3)
      }
    },
    dive: (swing) => {
      let up = lunge(swing)
      body.position.y -= up * 0.7 * air
      body.position.z += up * 0.45 * bulk
      body.rotation.x += up * 0.5
    },
    leap: (swing) => {
      let up = Math.sin(swing * Math.PI)
      body.position.y = Math.max(body.position.y, at.y + up * 0.25 * bulk)
      body.position.z += up * 0.55 * bulk
      if (legs.length) body.rotation.x = -up * 0.3
      else body.scale.y *= 1 - up * 0.2
    },
    flare: (swing) => {
      let up = lunge(swing)
      body.position.z += up * 0.6 * bulk
      for (let s of spins) s.bone.scale.multiplyScalar(1 + up * 0.35)
    },
  }

  return {
    root,
    material: m,
    height: f.height,
    animate: (a, dt) => {
      for (let h of parts) {
        h.bone.position.copy(h.pivot)
        h.bone.rotation.copy(h.turn)
        h.bone.scale.setScalar(1)
      }
      body.position.copy(at)
      body.rotation.set(0, 0, 0)
      body.scale.setScalar(1)
      flash(m, a.hurt * 0.8)
      if (a.down) {
        FALLS[f.fall](body)
        body.position.y = low
        return
      }
      GAITS[f.gait](a, dt)
      // Still, it looks about, and on the ground dips its head now and then.
      let still = 1 - Math.min(1, a.speed / 3.5)
      let dip = grounded ? Math.max(0, Math.sin(a.t * 0.9 + seed) - 0.8) * 5 : 0
      for (let h of heads) {
        h.bone.rotation.y += Math.sin(a.t * 0.6 + seed) * 0.2 * still
        h.bone.rotation.x += (Math.sin(a.t * 1.3 + seed) * 0.05 + dip * 0.4) *
          still
      }
      for (let t of tails) {
        let wag = Math.sin(a.t * 2.4 + seed) * 0.25
        if (t.lies == 'hangs') t.bone.rotation.z += wag
        else t.bone.rotation.y += wag
      }
      for (let s of spins) {
        s.bone.rotation.x += a.t * 0.7
        s.bone.rotation.y += a.t * 1.1
        s.bone.scale.setScalar(1 + Math.sin(a.t * 5) * 0.04)
      }
      if (a.swing < 0) return
      BITES[f.bite](a.swing)
      let up = lunge(a.swing)
      for (let t of tails) if (t.lies == 'curls') t.bone.rotation.x += up * 1.1
      for (let j of jaws) {
        j.bone.rotation.x -= up * 0.6
        j.bone.rotation.y += j.side * up * 0.5
      }
    },
  }
}
