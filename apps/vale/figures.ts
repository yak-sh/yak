// Who moves in the vale, and how: the heroes, the people who give quests, and
// the creatures, each a little jointed figure of soft boxes (parts.ts), and
// the animation that walks, hops, swings and falls it. A creature is drawn by
// the body plan its row names (beasts.ts `Look`), one plan to a file in
// bodies/, in the row's colours and at its row's scale; a new plan is one
// more file there and one more row in `PLANS`. A figure is told what it is
// doing (`Act`) every frame and poses itself; it keeps no state of the world.
// Each figure is drawn as one skinned mesh, its parts the bones (parts.ts
// `knit`).
//
// People are built like children, the way they are in Portal Knights: a big
// head on a round middle, short arms and legs bending at elbow and knee, big
// hands and feet. A hero stands 1.3 m, and wears what they wear: their weapon
// in the right hand, what goes with it in the left, and their armour over
// their tunic, each drawn from the item's own look (items.ts). How they swing
// is their weapon's: up and over for a blade, a stab for a dagger, a draw and
// a loose for a bow, a thrust for a staff.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { BEASTS, type Look, type Plans } from './beasts.ts'
import { ITEMS } from './items.ts'
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
import {
  type Box,
  ease,
  knit,
  limb,
  lunge,
  partOf,
  shade,
  stride,
} from './parts.ts'
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
  /** how far through a roll, 0 to 1, or -1 for none */
  roll: number
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

// Turn a part `k` of the way from where it is posed toward `x`.
let toward = (o: THREE.Object3D, x: number, k: number) =>
  o.rotation.x = lerp(o.rotation.x, x, k)

/** What a hero wears: the kind of item in each slot (play.ts `gear`). */
export type Dress = Record<string, string | undefined>

// A thing held, from its look (items.ts), which stands upright on its grip:
// hung from the hand for what is swung, or stood on the hand, `at` metres up
// it, for what is held upright.
let grip = (kind: string, at: number | 'hung'): Box[] =>
  (ITEMS[kind]?.look ?? []).map(([[x, y, z], [w, h, d], c]) =>
    at == 'hung' ? [[x, 0.07 - y - h, z], [w, h, d], c] : [[x, y - at, z], [
      w,
      h,
      d,
    ], c]
  )

// The colour of the `i`th box of a kind's look: its tier's metal, leather or
// cloth.
let tone = (kind: string, i = 0) => ITEMS[kind]?.look[i]?.[2] ?? 0x808080

// Armour over a head, by weight, in the head's space.
let HATS: Record<string, (c: number, trim: number) => Box[]> = {
  plate: (c, trim) => [
    [[-0.245, 0.2, -0.225], [0.49, 0.27, 0.46], c, 0.06],
    [[-0.03, 0.04, 0.2], [0.06, 0.18, 0.04], c],
    [[-0.03, 0.47, -0.16], [0.06, 0.07, 0.3], trim],
  ],
  leather: (c) => [
    [[-0.245, 0.25, -0.225], [0.49, 0.21, 0.46], c, 0.08],
    [[-0.245, 0.02, -0.235], [0.49, 0.26, 0.09], c],
  ],
  cloth: (c) => [
    [[-0.25, 0.2, -0.23], [0.5, 0.28, 0.48], c, 0.08],
    [[-0.25, 0, -0.23], [0.05, 0.22, 0.36], c],
    [[0.2, 0, -0.23], [0.05, 0.22, 0.36], c],
    [[-0.25, -0.04, -0.24], [0.5, 0.26, 0.09], c],
    [[-0.08, 0.46, -0.2], [0.16, 0.1, 0.18], c, 0.04],
  ],
}

// Armour over a middle, by weight, in the torso's space.
let COATS: Record<string, (c: number, trim: number) => Box[]> = {
  plate: (c, trim) => [
    [[-0.257, 0.06, -0.187], [0.514, 0.33, 0.394], c, 0.06],
    [[-0.26, 0.05, -0.19], [0.52, 0.05, 0.4], trim],
    [[-0.34, 0.3, -0.1], [0.12, 0.08, 0.2], c],
    [[0.22, 0.3, -0.1], [0.12, 0.08, 0.2], c],
  ],
  leather: (c, trim) => [
    [[-0.253, 0.04, -0.184], [0.506, 0.35, 0.388], c, 0.08],
    [[-0.02, 0.1, 0.2], [0.04, 0.24, 0.01], trim],
  ],
  cloth: (c, trim) => [
    [[-0.252, 0, -0.183], [0.504, 0.4, 0.386], c, 0.08],
    [[-0.25, -0.3, -0.19], [0.5, 0.33, 0.38], c, 0.06],
    [[-0.255, 0.03, -0.19], [0.51, 0.06, 0.39], trim],
  ],
}

/** One of the people of the vale, in their own colours: a sword in their
 * right hand, or a staff to lean on if they are old enough to want one; or,
 * for a hero, what they wear (`dress`). */
export let person = (
  look: { tint: string; hair: string; skin: string },
  staff = false,
  dress?: Dress,
): Figure => {
  let m = soft({ speckle: 0.06 })
  let tint = new THREE.Color(look.tint).getHex()
  let hair = new THREE.Color(look.hair).getHex()
  let skin = new THREE.Color(look.skin).getHex()
  let belt = 0x3d2c20
  let worn = (slot: string) => {
    let kind = dress?.[slot]
    return kind && ITEMS[kind] ? kind : ''
  }
  let weight = (slot: string) => ITEMS[worn(slot)]?.weight ?? ''
  let feet = worn('feet')
  let pants = weight('feet') == 'plate' ? tone(feet) : 0x5b4a3e
  let boots = feet ? tone(feet) : 0x5a3c28
  let sole = weight('feet') == 'cloth' ? 0.08 : 0.14
  let root = new THREE.Group()
  let body = new THREE.Group()
  root.add(body)
  let hips = new THREE.Group()
  hips.position.y = 0.44
  body.add(hips)
  // A thigh, and a shin in a big boot.
  let leg = (x: number) =>
    limb(
      [[[-0.09, -0.22, -0.09], [0.18, 0.28, 0.18], pants, 0.06]],
      [
        [[-0.085, -0.12, -0.085], [0.17, 0.17, 0.17], pants, 0.06],
        [[-0.1, -0.24, -0.11], [0.2, sole, 0.27], boots, 0.06],
      ],
      [x, 0, 0],
      [0, -0.2, 0],
    )
  let legL = leg(-0.105), legR = leg(0.105)
  hips.add(legL[0], legR[0])
  // A round middle: a tunic wider and deeper at the tummy than at the
  // shoulders, belted under it.
  let torso = partOf([
    [[-0.22, -0.04, -0.15], [0.44, 0.46, 0.3], tint, 0.1],
    [[-0.245, 0.02, -0.17], [0.49, 0.25, 0.36], tint, 0.1],
    [[-0.255, 0.03, -0.18], [0.51, 0.075, 0.38], belt],
    [[-0.05, 0.035, 0.2], [0.1, 0.07, 0.01], 0xe7c35a],
    [[-0.15, 0.33, 0.12], [0.3, 0.1, 0.05], shade(tint, 0.8)],
    ...(COATS[weight('body')]?.(tone(worn('body')), tone(worn('body'), 1)) ??
      []),
  ], [0, 0, 0])
  hips.add(torso)
  // An upper arm, and a forearm ending in a big hand.
  let arm = (x: number) =>
    limb(
      [[[-0.07, -0.2, -0.075], [0.14, 0.25, 0.15], tint, 0.05]],
      [
        [[-0.065, -0.12, -0.07], [0.13, 0.15, 0.14], tint, 0.05],
        [[-0.085, -0.25, -0.085], [0.17, 0.15, 0.17], skin, 0.07],
      ],
      [x, 0.34, 0],
      [0, -0.18, 0],
    )
  let [armL, foreL] = arm(-0.31), [armR, foreR] = arm(0.31)
  torso.add(armL, armR)
  // Held in the right hand: a blade angled out before them, or a staff or a
  // bow upright; nothing, for a hero with nothing in hand. What goes with it
  // is held in the left.
  let family = dress ? ITEMS[worn('main')]?.family ?? 'fists' : 'sword'
  let upright = staff || family == 'staff' || family == 'bow'
  let held = !dress
    ? partOf(
      staff
        ? [
          [[-0.035, -0.44, -0.035], [0.07, 1.46, 0.07], 0x6a4a30],
          [[-0.07, 1.02, -0.07], [0.14, 0.12, 0.14], 0x8fd46a],
        ]
        : [
          [[-0.025, -0.07, -0.025], [0.05, 0.14, 0.05], 0x6a4a30],
          [[-0.1, -0.11, -0.035], [0.2, 0.04, 0.07], 0xe2b64c],
          [[-0.03, -0.5, -0.01], [0.06, 0.4, 0.02], 0xdfe6ee],
        ],
      [0, -0.19, 0.03],
      0.05,
    )
    : partOf(
      grip(
        worn('main'),
        family == 'staff' ? 0.4 : family == 'bow' ? 0.42 : 'hung',
      ),
      [0, -0.19, 0.03],
      0.05,
    )
  foreR.add(held)
  let off = worn('off'), side = ITEMS[off]?.family
  let other = partOf(
    side == 'shield'
      ? grip(off, 0.23).map((
        [[x, y, z], size, c],
      ) => [[x, y, z + 0.1], size, c])
      : side == 'torch'
      ? grip(off, 0.06)
      : side == 'tome'
      ? grip(off, 0.03).map((
        [[x, y, z], size, c],
      ) => [[x, y, z + 0.08], size, c])
      : [],
    [0, -0.19, 0.03],
    0.05,
  )
  foreL.add(other)
  let head = partOf([
    [[-0.22, 0, -0.2], [0.44, 0.4, 0.4], skin, 0.1],
    [[-0.23, 0.3, -0.21], [0.46, 0.14, 0.42], hair, 0.08],
    [[-0.23, 0.04, -0.215], [0.46, 0.3, 0.09], hair],
    [[-0.23, 0.14, -0.21], [0.05, 0.2, 0.3], hair],
    [[0.18, 0.14, -0.21], [0.05, 0.2, 0.3], hair],
    [[-0.2, 0.28, 0.19], [0.4, 0.06, 0.03], hair],
    [[-0.14, 0.12, 0.195], [0.08, 0.11, 0.02], 0x2b2733],
    [[0.06, 0.12, 0.195], [0.08, 0.11, 0.02], 0x2b2733],
    [[-0.12, 0.19, 0.2], [0.03, 0.03, 0.02], 0xffffff],
    [[0.08, 0.19, 0.2], [0.03, 0.03, 0.02], 0xffffff],
    [[-0.05, 0.05, 0.195], [0.1, 0.03, 0.02], shade(skin, 0.8)],
    ...(HATS[weight('head')]?.(tone(worn('head')), tone(worn('head'), 1)) ??
      []),
  ], [0, 0.42, 0])
  torso.add(head)
  let cape = partOf([[
    [-0.18, -0.46, -0.03],
    [0.36, 0.48, 0.035],
    shade(tint, 0.72),
  ]], [0, 0.4, -0.16])
  torso.add(cape)

  // How the right hand rests: bent a little at the elbow, and what it holds
  // turned upright, a staff or a bow, or out before them, a blade; the left
  // holds its torch upright.
  let rest = -0.5
  let hold = upright ? -rest : -0.6
  other.rotation.x = side == 'torch' ? 0.3 : 0
  // A blow, `w` of the way through it: the weapon's own.
  let swing = (w: number) => {
    let up = lunge(w, 0.35)
    if (family == 'dagger' || family == 'fists') {
      // A stab: the arm drives straight out and back.
      up = lunge(w, 0.3)
      armR.rotation.x = lerp(0.3, -1.5, up)
      foreR.rotation.x = lerp(-1.3, -0.05, up)
      torso.rotation.y = lerp(0.25, -0.3, up)
    } else if (family == 'bow') {
      // Drawn and held to the loose, a third of the way in, the bow upright
      // before them and the string at the chin.
      let d = w < 0.33 ? ease(w / 0.33) : 1 - ease((w - 0.33) / 0.67) * 0.7
      armR.rotation.x = -1.5 * d
      foreR.rotation.x = rest * (1 - d)
      held.rotation.x = hold + 1.5 * d
      armL.rotation.x = -1.35 * d
      armL.rotation.z = -0.5 * d
      foreL.rotation.x = -1.4 * d
      torso.rotation.y = 0.45 * d
    } else if (family == 'staff') {
      // Pointed at the foe: the staff tips forward as the arm comes up.
      armR.rotation.x = lerp(0.2, -1.2, up)
      foreR.rotation.x = lerp(rest, -0.2, up)
      held.rotation.x = hold + 0.9 * up
      torso.rotation.y = lerp(0.2, -0.2, up)
    } else {
      // Up and over: the blade rises behind the head, the elbow bent, then
      // falls through the foe in front as the arm straightens.
      armR.rotation.x = lerp(0.4, -2.7, up)
      armR.rotation.z = lerp(0.1, 0.3, up)
      foreR.rotation.x = lerp(-0.2, -1.3, up)
      torso.rotation.y = lerp(0.35, -0.3, up)
      armL.rotation.x = lerp(-0.3, 0.3, up)
    }
  }
  let phase = 0
  return sewn({
    root,
    material: m,
    height: 1.5,
    animate: (a, dt) => {
      phase += dt * (2 + a.speed * 3.4)
      let amp = Math.min(1, a.speed / 4.5) * 0.85
      let s = Math.sin(phase), c = Math.cos(phase)
      stride(legL, s, c, amp)
      stride(legR, -s, -c, amp)
      armL.rotation.set(-s * amp * 0.8, 0, -0.08)
      armR.rotation.set(s * amp * 0.8, 0, 0.08)
      foreL.rotation.x = -0.3 - amp * 0.4
      foreR.rotation.x = rest
      held.rotation.x = hold
      body.position.y = Math.abs(c) * 0.05 * amp
      torso.rotation.set(amp * 0.08, 0, 0)
      torso.scale.y = 1 + Math.sin(a.t * 2.2) * 0.012
      head.rotation.set(-amp * 0.06, Math.sin(a.t * 0.7) * 0.15 * (1 - amp), 0)
      cape.rotation.x = 0.08 + amp * 0.7 + Math.sin(a.t * 5) * 0.04
      if (a.air) {
        legL[0].rotation.x = -0.8
        legL[1].rotation.x = 1.2
        legR[0].rotation.x = 0.3
        legR[1].rotation.x = 0.5
        armL.rotation.z = -0.6
        armR.rotation.z = 0.6
        foreL.rotation.x = foreR.rotation.x = -0.6
        cape.rotation.x = 0.9
      }
      if (a.roll >= 0) {
        // Curled up for a roll: knees to the chest, arms round them.
        let k = Math.min(1, a.roll / 0.15, (1 - a.roll) / 0.15)
        for (let l of [legL, legR]) {
          toward(l[0], -1.9, k)
          toward(l[1], 2.2, k)
        }
        for (let [arm, fore] of [[armL, foreL], [armR, foreR]]) {
          toward(arm, -1.1, k)
          toward(fore, -1.5, k)
        }
        toward(torso, 0.4, k)
        toward(head, 0.3, k)
      }
      if (a.swing >= 0) swing(a.swing)
      if (a.down) {
        body.rotation.x = -Math.PI / 2 + 0.1
        body.position.y = 0.22
      } else body.rotation.x = 0
      flash(m, a.hurt * 0.7)
    },
  })
}

/** A hero in a player's colours, in what they wear. */
export let hero = (
  look: { tint: string; hair: string; skin: string },
  dress: Dress = {},
) => person(look, false, dress)

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
