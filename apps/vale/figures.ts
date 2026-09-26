// Who moves in the vale, and how: the heroes, the people who give quests, and
// the creatures, each a little jointed figure of soft boxes (parts.ts), and
// the animation that walks, hops, swings and falls it. A creature is drawn by
// the body plan its row names (beasts.ts `Look`), one plan to a file in
// bodies/, in the row's colours and at its row's scale; a new plan is one
// more file there and one more row in `PLANS`. A figure is told what it is
// doing (`Act`) every frame and poses itself; it keeps no state of the world.
// Each figure is drawn as one skinned mesh, its parts the bones (parts.ts
// `knit`).
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { BEASTS, type Look, type Plans } from './beasts.ts'
import { biped } from './bodies/biped.ts'
import { bird } from './bodies/bird.ts'
import { crag } from './bodies/crag.ts'
import { crawler } from './bodies/crawler.ts'
import { flier } from './bodies/flier.ts'
import { hopper } from './bodies/hopper.ts'
import { quadruped } from './bodies/quadruped.ts'
import { serpent } from './bodies/serpent.ts'
import { slime } from './bodies/slime.ts'
import { wisp } from './bodies/wisp.ts'
import { ease, knit, partOf, shade } from './parts.ts'
import { lerp } from './rand.ts'
import { flash, soft } from './soft.ts'

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

// Stitch a figure's parts into the one mesh it is drawn as.
let sewn = (f: Figure): Figure => {
  knit(f.root, f.material)
  return f
}

/** A hero in a player's colours. */
export let hero = (look: { tint: string; hair: string; skin: string }) =>
  sewn(heroOf(look))

// A hero before it is sewn, so a person can be given a staff first.
let heroOf = (
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
    partOf([
      [[-0.1, -0.8, -0.11], [0.2, 0.62, 0.22], pants],
      [[-0.11, -0.8, -0.12], [0.22, 0.2, 0.26], boots],
    ], [x, 0, 0])
  let legL = leg(-0.13), legR = leg(0.13)
  hips.add(legL, legR)
  let torso = partOf([
    [[-0.27, 0, -0.16], [0.54, 0.62, 0.32], tint],
    [[-0.28, 0.02, -0.17], [0.56, 0.09, 0.34], belt],
    [[-0.05, 0.03, 0.17], [0.1, 0.07, 0.01], 0xe7c35a],
    [[-0.2, 0.46, 0.12], [0.4, 0.14, 0.06], shade(tint, 0.8)],
  ], [0, 0, 0])
  hips.add(torso)
  let arm = (x: number) =>
    partOf([
      [[-0.09, -0.4, -0.1], [0.18, 0.44, 0.2], tint],
      [[-0.08, -0.56, -0.09], [0.16, 0.18, 0.18], skin],
    ], [x, 0.56, 0])
  let armL = arm(-0.36), armR = arm(0.36)
  torso.add(armL, armR)
  let sword = partOf(
    [
      [[-0.03, -0.12, -0.03], [0.06, 0.18, 0.06], 0x6a4a30],
      [[-0.12, -0.16, -0.04], [0.24, 0.05, 0.08], 0xe2b64c],
      [[-0.035, -0.86, -0.012], [0.07, 0.7, 0.024], 0xdfe6ee],
    ],
    [0, -0.5, 0.02],
    0.05,
  )
  armR.add(sword)
  let head = partOf([
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
  let cape = partOf([[
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

// Every body plan, by the name a row gives it.
let PLANS: { [P in keyof Plans]: (l: Plans[P]) => Figure } = {
  biped,
  bird,
  crag,
  crawler,
  flier,
  hopper,
  quadruped,
  serpent,
  slime,
  wisp,
}

let draw = <P extends keyof Plans>(l: { plan: P } & Plans[P]) =>
  PLANS[l.plan](l)

/** A creature of the given kind, drawn by its row's body plan (beasts.ts) at
 * its row's scale. */
export let beast = (kind: string): Figure => {
  let l: Look = (BEASTS[kind] ?? BEASTS.slime).look
  let f = sewn(draw(l))
  let k = l.scale ?? 1
  f.root.scale.setScalar(k)
  return { ...f, height: f.height * k }
}

/** One of the people of the vale: a hero in their own colours, leaning on a
 * staff if they are old enough to want one. */
export let person = (
  look: { tint: string; hair: string; skin: string },
  staff = false,
): Figure => {
  let f = heroOf(look)
  if (!staff) return sewn(f)
  f.root.add(partOf(
    [
      [[-0.04, 0, -0.04], [0.08, 1.9, 0.08], 0x6a4a30],
      [[-0.08, 1.9, -0.08], [0.16, 0.14, 0.16], 0x8fd46a],
    ],
    [0.48, 0, 0.18],
    0.05,
  ))
  return sewn(f)
}
