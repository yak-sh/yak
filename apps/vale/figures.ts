// Who moves in the vale, and how: the heroes and the creatures, each a little
// jointed figure of soft boxes (mesh.ts `cuboid`), and the animation that
// walks, hops, swings and falls it. A figure is told what it is doing (`Act`)
// every frame and poses itself; it keeps no state of the world.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { cuboid, out, type Vec } from './mesh.ts'
import { lerp } from './rand.ts'
import { flash, geometry, soft } from './soft.ts'

/** What a figure is doing this frame. */
export type Act = {
  /** metres a second over the ground */
  speed: number
  /** off the ground */
  air: boolean
  /** how far through a blow or a bite, 0 to 1, or -1 for none */
  swing: number
  /** how freshly struck, 1 just now to 0 */
  hurt: number
  down: boolean
  /** seconds, for idling */
  t: number
}

export type Figure = {
  root: THREE.Group
  material: THREE.Material
  /** where a name plate sits, above the root */
  height: number
  animate: (a: Act, dt: number) => void
}

type Box = [Vec, Vec, number]

let partOf = (
  material: THREE.Material,
  boxes: Box[],
  pivot: Vec,
  cell = 0.1,
): THREE.Group => {
  let o = out()
  for (let [min, size, color] of boxes) cuboid(o, min, size, color, cell)
  let mesh = new THREE.Mesh(geometry(o), material)
  mesh.castShadow = true
  let g = new THREE.Group()
  g.position.set(...pivot)
  g.add(mesh)
  return g
}

let shade = (hex: number, k: number) => {
  let c = new THREE.Color(hex)
  c.multiplyScalar(k)
  return c.getHex()
}

let ease = (t: number) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2

/** A hero in a player's colours. */
export let hero = (
  look: { tint: string; hair: string; skin: string },
): Figure => {
  let m = soft({ speckle: 0.06 })
  let tint = new THREE.Color(look.tint).getHex()
  let hair = new THREE.Color(look.hair).getHex()
  let skin = new THREE.Color(look.skin).getHex()
  let pants = shade(0x5b4a3e, 1), boots = 0x5a3c28, belt = 0x3d2c20
  let root = new THREE.Group()
  let body = new THREE.Group()
  root.add(body)
  let hips = new THREE.Group()
  hips.position.y = 0.8
  body.add(hips)
  let leg = (x: number) =>
    partOf(m, [
      [[-0.1, -0.8, -0.11], [0.2, 0.62, 0.22], pants],
      [[-0.11, -0.8, -0.12], [0.22, 0.2, 0.26], boots],
    ], [x, 0, 0])
  let legL = leg(-0.13), legR = leg(0.13)
  hips.add(legL, legR)
  let torso = partOf(m, [
    [[-0.27, 0, -0.16], [0.54, 0.62, 0.32], tint],
    [[-0.28, 0.02, -0.17], [0.56, 0.09, 0.34], belt],
    [[-0.05, 0.03, 0.17], [0.1, 0.07, 0.01], 0xe7c35a],
    [[-0.2, 0.46, 0.12], [0.4, 0.14, 0.06], shade(tint, 0.8)],
  ], [0, 0, 0])
  hips.add(torso)
  let arm = (x: number) =>
    partOf(m, [
      [[-0.09, -0.4, -0.1], [0.18, 0.44, 0.2], tint],
      [[-0.08, -0.56, -0.09], [0.16, 0.18, 0.18], skin],
    ], [x, 0.56, 0])
  let armL = arm(-0.36), armR = arm(0.36)
  torso.add(armL, armR)
  let sword = partOf(
    m,
    [
      [[-0.03, -0.12, -0.03], [0.06, 0.18, 0.06], 0x6a4a30],
      [[-0.12, -0.16, -0.04], [0.24, 0.05, 0.08], 0xe2b64c],
      [[-0.035, -0.86, -0.012], [0.07, 0.7, 0.024], 0xdfe6ee],
    ],
    [0, -0.5, 0.02],
    0.05,
  )
  armR.add(sword)
  let head = partOf(m, [
    [[-0.19, 0, -0.18], [0.38, 0.38, 0.36], skin],
    [[-0.2, 0.28, -0.19], [0.4, 0.13, 0.38], hair],
    [[-0.2, 0.05, -0.2], [0.4, 0.26, 0.08], hair],
    [[-0.2, 0.14, -0.19], [0.05, 0.16, 0.3], hair],
    [[0.15, 0.14, -0.19], [0.05, 0.16, 0.3], hair],
    [[-0.12, 0.13, 0.175], [0.07, 0.09, 0.02], 0x2b2733],
    [[0.05, 0.13, 0.175], [0.07, 0.09, 0.02], 0x2b2733],
    [[-0.1, 0.19, 0.18], [0.025, 0.025, 0.02], 0xffffff],
    [[0.07, 0.19, 0.18], [0.025, 0.025, 0.02], 0xffffff],
    [[-0.07, 0.07, 0.175], [0.14, 0.03, 0.02], shade(skin, 0.8)],
  ], [0, 0.63, 0])
  torso.add(head)
  let cape = partOf(m, [[
    [-0.23, -0.7, -0.03],
    [0.46, 0.72, 0.04],
    shade(tint, 0.72),
  ]], [
    0,
    0.6,
    -0.18,
  ])
  torso.add(cape)

  let phase = 0
  return {
    root,
    material: m,
    height: 2.15,
    animate: (a, dt) => {
      phase += dt * (2 + a.speed * 1.9)
      let amp = Math.min(1, a.speed / 4.5) * 0.85
      let s = Math.sin(phase)
      legL.rotation.x = s * amp
      legR.rotation.x = -s * amp
      armL.rotation.x = -s * amp * 0.8
      armR.rotation.x = s * amp * 0.8
      armL.rotation.z = -0.08
      armR.rotation.z = 0.08
      body.position.y = Math.abs(Math.cos(phase)) * 0.07 * amp
      torso.rotation.set(amp * 0.08, 0, 0)
      torso.scale.y = 1 + Math.sin(a.t * 2.2) * 0.012
      head.rotation.set(-amp * 0.06, Math.sin(a.t * 0.7) * 0.15 * (1 - amp), 0)
      cape.rotation.x = 0.08 + amp * 0.7 + Math.sin(a.t * 5) * 0.04
      if (a.air) {
        legL.rotation.x = -0.7
        legR.rotation.x = 0.35
        armL.rotation.z = -0.6
        armR.rotation.z = 0.6
        cape.rotation.x = 0.9
      }
      if (a.swing >= 0) {
        // Up and over: the blade rises behind the head, then falls through
        // the foe in front.
        let w = a.swing
        let up = w < 0.35 ? ease(w / 0.35) : 1 - ease((w - 0.35) / 0.65)
        armR.rotation.x = lerp(0.5, -2.7, up)
        armR.rotation.z = lerp(0.1, 0.3, up)
        torso.rotation.y = lerp(0.35, -0.3, up)
        armL.rotation.x = lerp(-0.3, 0.3, up)
      }
      if (a.down) {
        body.rotation.x = -Math.PI / 2 + 0.1
        body.position.y = 0.2
      } else body.rotation.x = 0
      flash(m, a.hurt * 0.7)
    },
  }
}

// A four-legged beast: body, head with snout and tusks, four legs and a ridge
// of bristles, or thorns.
let quadruped = (
  opts: {
    hide: number
    ridge: number
    snout: number
    tusk: number
    eye: number
    scale: number
    thorns?: boolean
  },
): Figure => {
  let m = soft({ speckle: 0.1 })
  let { hide, ridge, snout, tusk, eye } = opts
  let root = new THREE.Group()
  let body = new THREE.Group()
  body.scale.setScalar(opts.scale)
  root.add(body)
  let trunk = partOf(m, [
    [[-0.33, 0.36, -0.6], [0.66, 0.58, 1.2], hide],
    [[-0.08, 0.92, -0.5], [0.16, 0.1, 0.95], ridge],
    [[-0.3, 0.34, -0.55], [0.6, 0.1, 1.05], shade(hide, 0.85)],
    [[-0.04, 0.6, -0.68], [0.08, 0.18, 0.1], ridge],
    ...(opts.thorns
      ? [0, 1, 2, 3, 4].flatMap((i): Box[] => [
        [
          [-0.05, 0.98, -0.42 + i * 0.2],
          [0.1, 0.22 + (i % 2) * 0.08, 0.1],
          0xe0d0b0,
        ],
        [[-0.26, 0.86, -0.36 + i * 0.2], [0.07, 0.16, 0.07], 0xd8c29a],
        [[0.19, 0.86, -0.36 + i * 0.2], [0.07, 0.16, 0.07], 0xd8c29a],
      ])
      : []),
  ], [0, 0, 0])
  body.add(trunk)
  let head = partOf(m, [
    [[-0.25, -0.24, 0], [0.5, 0.46, 0.4], hide],
    [[-0.14, -0.2, 0.38], [0.28, 0.2, 0.14], snout],
    [[-0.09, -0.14, 0.52], [0.05, 0.06, 0.01], 0x3a2a26],
    [[0.04, -0.14, 0.52], [0.05, 0.06, 0.01], 0x3a2a26],
    [[-0.2, -0.16, 0.44], [0.06, 0.2, 0.06], tusk],
    [[0.14, -0.16, 0.44], [0.06, 0.2, 0.06], tusk],
    [[-0.19, 0.04, 0.4], [0.08, 0.08, 0.01], eye],
    [[0.11, 0.04, 0.4], [0.08, 0.08, 0.01], eye],
    [[-0.24, 0.18, 0.06], [0.12, 0.14, 0.06], ridge],
    [[0.12, 0.18, 0.06], [0.12, 0.14, 0.06], ridge],
  ], [0, 0.66, 0.58])
  body.add(head)
  let leg = (x: number, z: number) =>
    partOf(m, [
      [[-0.08, -0.4, -0.08], [0.16, 0.4, 0.16], shade(hide, 0.8)],
      [[-0.085, -0.4, -0.085], [0.17, 0.08, 0.17], 0x3a2a22],
    ], [x, 0.42, z])
  let legs = [
    leg(-0.21, 0.38),
    leg(0.21, 0.38),
    leg(-0.21, -0.4),
    leg(0.21, -0.4),
  ]
  body.add(...legs)
  let phase = 0
  return {
    root,
    material: m,
    height: 1.35 * opts.scale + 0.3,
    animate: (a, dt) => {
      phase += dt * (1.5 + a.speed * 2.6)
      let amp = Math.min(1, a.speed / 3.5) * 0.7
      let s = Math.sin(phase)
      legs[0].rotation.x = s * amp
      legs[3].rotation.x = s * amp
      legs[1].rotation.x = -s * amp
      legs[2].rotation.x = -s * amp
      body.position.y = Math.abs(Math.cos(phase)) * 0.05 * amp * opts.scale
      trunk.rotation.x = 0
      head.rotation.set(Math.sin(a.t * 1.3) * 0.05 * (1 - amp), 0, 0)
      if (a.swing >= 0) {
        let up = a.swing < 0.4
          ? ease(a.swing / 0.4)
          : 1 - ease((a.swing - 0.4) / 0.6)
        head.rotation.x = lerp(0.1, -0.55, up)
        body.position.z = up * 0.25 * opts.scale
      } else body.position.z = 0
      if (a.down) {
        body.rotation.z = Math.PI / 2
        body.position.y = 0.3 * opts.scale
      } else body.rotation.z = 0
      flash(m, a.hurt * 0.8)
    },
  }
}

// A slime: a jelly cube with moss on its back, which hops.
let slime = (): Figure => {
  let m = soft({ speckle: 0.08 })
  let root = new THREE.Group()
  let jelly = new THREE.Group()
  root.add(jelly)
  let green = 0x7ccc55
  let bodyPart = partOf(
    m,
    [
      [[-0.42, 0, -0.42], [0.84, 0.72, 0.84], green],
      [[-0.44, 0.62, -0.44], [0.88, 0.14, 0.88], 0x4f9a3a],
      [[-0.2, 0.76, -0.1], [0.14, 0.1, 0.14], 0x5fae44],
      [[0.1, 0.76, 0.12], [0.1, 0.14, 0.1], 0xe7d45a],
      [[-0.3, 0.3, 0.42], [0.2, 0.22, 0.02], 0xffffff],
      [[0.1, 0.3, 0.42], [0.2, 0.22, 0.02], 0xffffff],
      [[-0.24, 0.32, 0.43], [0.1, 0.13, 0.02], 0x243020],
      [[0.16, 0.32, 0.43], [0.1, 0.13, 0.02], 0x243020],
      [[-0.08, 0.16, 0.42], [0.16, 0.05, 0.02], 0x3f7a30],
      [[-0.3, 0, -0.3], [0.6, 0.06, 0.6], shade(green, 0.8)],
    ],
    [0, 0, 0],
    0.12,
  )
  jelly.add(bodyPart)
  let phase = Math.random() * 6
  return {
    root,
    material: m,
    height: 1.2,
    animate: (a, dt) => {
      phase += dt * (a.speed > 0.2 ? 7 : 2.5)
      let hop = a.speed > 0.2 ? Math.max(0, Math.sin(phase)) : 0
      let squash = a.speed > 0.2
        ? 1 - Math.max(0, -Math.sin(phase)) * 0.25 + hop * 0.12
        : 1 + Math.sin(phase) * 0.04
      jelly.position.y = hop * 0.45
      jelly.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash))
      if (a.swing >= 0) {
        let up = Math.sin(a.swing * Math.PI)
        jelly.position.z = up * 0.45
        jelly.scale.y *= 1 - up * 0.2
      } else jelly.position.z = 0
      if (a.down) jelly.scale.set(1.4, 0.2, 1.4)
      flash(m, a.hurt * 0.8)
    },
  }
}

// A cragback: a walking heap of stone, moss on its shell and embers for eyes.
let crag = (): Figure => {
  let m = soft({ speckle: 0.14 })
  let root = new THREE.Group()
  let body = new THREE.Group()
  root.add(body)
  let stone = 0x8e8c84, light = 0xa4a298, moss = 0x6a9a48
  let shell = partOf(
    m,
    [
      [[-0.72, 0.3, -0.8], [1.44, 0.55, 1.6], stone],
      [[-0.56, 0.85, -0.64], [1.12, 0.35, 1.28], light],
      [[-0.36, 1.2, -0.42], [0.72, 0.25, 0.84], stone],
      [[-0.3, 1.18, -0.2], [0.44, 0.1, 0.5], moss],
      [[0.2, 1.02, 0.3], [0.3, 0.08, 0.28], moss],
      [[-0.5, 0.98, -0.5], [0.24, 0.06, 0.3], moss],
      [[0.34, 0.8, -0.6], [0.3, 0.2, 0.24], 0x7a7870],
      [[-0.66, 0.28, -0.74], [1.32, 0.1, 1.48], 0x6f6d66],
    ],
    [0, 0, 0],
    0.15,
  )
  body.add(shell)
  let head = partOf(
    m,
    [
      [[-0.26, -0.22, 0], [0.52, 0.44, 0.46], light],
      [[-0.18, 0.02, 0.45], [0.12, 0.09, 0.02], 0xffb347],
      [[0.06, 0.02, 0.45], [0.12, 0.09, 0.02], 0xffb347],
      [[-0.22, 0.2, 0.05], [0.44, 0.08, 0.3], moss],
    ],
    [0, 0.6, 0.78],
    0.12,
  )
  body.add(head)
  let leg = (x: number, z: number) =>
    partOf(m, [[[-0.16, -0.36, -0.16], [0.32, 0.4, 0.32], 0x7f7d75]], [
      x,
      0.38,
      z,
    ], 0.12)
  let legs = [leg(-0.5, 0.5), leg(0.5, 0.5), leg(-0.5, -0.55), leg(0.5, -0.55)]
  body.add(...legs)
  let phase = 0
  return {
    root,
    material: m,
    height: 2,
    animate: (a, dt) => {
      phase += dt * (1 + a.speed * 2.4)
      let amp = Math.min(1, a.speed / 2.4) * 0.45
      let s = Math.sin(phase)
      legs[0].rotation.x = s * amp
      legs[3].rotation.x = s * amp
      legs[1].rotation.x = -s * amp
      legs[2].rotation.x = -s * amp
      body.rotation.z = Math.sin(phase) * 0.04 * amp
      head.position.y = 0.6 + Math.sin(a.t * 1.1) * 0.02
      if (a.swing >= 0) {
        let up = Math.sin(a.swing * Math.PI)
        head.position.z = 0.78 + up * 0.35
        body.rotation.x = -up * 0.12
      } else {
        head.position.z = 0.78
        body.rotation.x = 0
      }
      if (a.down) {
        body.rotation.z = Math.PI * 0.9
        body.position.y = 1.4
      } else body.position.y = 0
      flash(m, a.hurt * 0.8)
    },
  }
}

/** A creature of the given kind. */
export let beast = (kind: string): Figure =>
  kind == 'slime'
    ? slime()
    : kind == 'crag'
    ? crag()
    : kind == 'thornback'
    ? quadruped({
      hide: 0x7a3f2f,
      ridge: 0x4a2419,
      snout: 0xb87a6a,
      tusk: 0xf1e6cf,
      eye: 0xff5a3a,
      scale: 2.3,
      thorns: true,
    })
    : quadruped({
      hide: 0x8a5a3c,
      ridge: 0x5a3a26,
      snout: 0xd99a8a,
      tusk: 0xf4ecd8,
      eye: 0x2b2020,
      scale: 1,
    })

/** An elder by the fire: a hero in a long green robe, leaning on a staff. */
export let elder = (): Figure => {
  let f = hero({ tint: '#4f7a4a', hair: '#e9e6df', skin: '#d9a98a' })
  let staff = partOf(
    f.material,
    [
      [[-0.04, 0, -0.04], [0.08, 1.9, 0.08], 0x6a4a30],
      [[-0.08, 1.9, -0.08], [0.16, 0.14, 0.16], 0x8fd46a],
    ],
    [0.48, 0, 0.18],
    0.05,
  )
  f.root.add(staff)
  return f
}
