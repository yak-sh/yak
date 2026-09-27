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
// head, a short straight middle, short arms and legs bending at elbow and
// knee, big hands and feet. A hero stands 1.3 m. A build is a few measures
// (`BUILDS`), so they can be drawn grown instead, to compare. A hero wears
// what they wear: their weapon in the right hand, what goes with it in the
// left, and their armour over their tunic, each drawn from the item's own
// look (items.ts). How they swing is their weapon's: up and over for a blade,
// a stab for a dagger, from each hand in turn with one in each, a draw and a
// loose for a bow, a thrust for a staff. An ability may pose them its own way
// (abilities.ts `Pose`): a turn all the way round, the other hand raised
// before them, both hands up, or both blades across the foe.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import type { Pose } from './abilities.ts'
import { BEASTS, type Look, type Plans } from './beasts.ts'
import type { Hand } from './gear.ts'
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
import type { Vec } from './mesh.ts'
import {
  type Box,
  ease,
  fit,
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
  /** how a hero's blow is posed, when not their weapon's own */
  pose?: Pose
  /** the hand a hero's blow is struck with: the other, every other blow,
   * for one with a blade in each (gear.ts `handOf`) */
  hand?: Hand
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

// Armour over a middle, by weight, in the torso's space: close over the
// tunic, as deep at the tummy as at the chest.
let COATS: Record<string, (c: number, trim: number) => Box[]> = {
  plate: (c, trim) => [
    [[-0.245, 0.06, -0.175], [0.49, 0.34, 0.35], c, 0.06],
    [[-0.25, 0.05, -0.18], [0.5, 0.05, 0.36], trim],
    [[-0.34, 0.3, -0.1], [0.12, 0.08, 0.2], c],
    [[0.22, 0.3, -0.1], [0.12, 0.08, 0.2], c],
  ],
  leather: (c, trim) => [
    [[-0.24, 0.04, -0.17], [0.48, 0.36, 0.34], c, 0.08],
    [[-0.02, 0.1, 0.17], [0.04, 0.24, 0.01], trim],
  ],
  cloth: (c, trim) => [
    [[-0.238, 0, -0.168], [0.476, 0.4, 0.336], c, 0.08],
    [[-0.24, -0.3, -0.17], [0.48, 0.33, 0.34], c, 0.06],
    [[-0.243, 0.03, -0.173], [0.486, 0.06, 0.346], trim],
  ],
}

/** How one of the people is built, in metres. A torso's boxes and the armour
 * over them are drawn for a child's torso, and a head's and its hat for a
 * child's head, and each is fit to the build's own (parts.ts `fit`). */
export type Build = {
  /** ground to hip */
  hips: number
  /** a leg's thickness, and how far out from the middle it stands */
  leg: number
  stance: number
  /** a boot's width and length */
  boot: [number, number]
  /** the torso's width, its height from hip to neck, and its depth */
  torso: Vec
  /** where a shoulder is, out from the middle and up from the hip */
  shoulder: [number, number]
  /** shoulder to fingertip, an arm's thickness and a hand's width */
  arm: number
  sleeve: number
  hand: number
  /** the head's width, height and depth */
  head: Vec
}

/** How the people of the vale are built: like children, the way they are in
 * Portal Knights (a big head, short arms and legs, big hands and boots), or
 * grown, as they were first drawn (`?build=grown`, main.ts). */
export let BUILDS: Record<string, Build> = {
  child: {
    hips: 0.44,
    leg: 0.18,
    stance: 0.105,
    boot: [0.2, 0.27],
    torso: [0.44, 0.42, 0.3],
    shoulder: [0.31, 0.34],
    arm: 0.43,
    sleeve: 0.14,
    hand: 0.17,
    head: [0.44, 0.4, 0.4],
  },
  grown: {
    hips: 0.8,
    leg: 0.2,
    stance: 0.13,
    boot: [0.22, 0.26],
    torso: [0.54, 0.62, 0.32],
    shoulder: [0.36, 0.56],
    arm: 0.56,
    sleeve: 0.18,
    hand: 0.16,
    head: [0.38, 0.38, 0.36],
  },
}

/** How tall someone of a build stands, ground to crown. */
export let stature = (b: Build) => b.hips + b.torso[1] + b.head[1]

// How much bigger than a child's `v` is, along each axis.
let over = (v: Vec, child: Vec): Vec => [
  v[0] / child[0],
  v[1] / child[1],
  v[2] / child[2],
]

/** One of the people of the vale, built `b`, in their own colours: a sword
 * in their right hand, or a staff to lean on if they are old enough to want
 * one; or, for a hero, what they wear (`dress`). */
export let person = (
  b: Build,
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
  let kt = over(b.torso, BUILDS.child.torso)
  let kh = over(b.head, BUILDS.child.head)
  let root = new THREE.Group()
  let body = new THREE.Group()
  root.add(body)
  let hips = new THREE.Group()
  hips.position.y = b.hips
  body.add(hips)
  // A thigh, and a shin in a boot, bending at the knee.
  let knee = b.hips * 0.45, shin = b.hips - knee, t = b.leg
  let [bw, bl] = b.boot
  let leg = (x: number) =>
    limb(
      [[[-t / 2, -knee - 0.02, -t / 2], [t, knee + 0.08, t], pants, 0.06]],
      [
        [
          [0.005 - t / 2, sole - shin - 0.02, 0.005 - t / 2],
          [t - 0.01, shin - sole + 0.07, t - 0.01],
          pants,
          0.06,
        ],
        [[-bw / 2, -shin, -t / 2 - 0.02], [bw, sole, bl], boots, 0.06],
      ],
      [x, 0, 0],
      [0, -knee, 0],
    )
  let legL = leg(-b.stance), legR = leg(b.stance)
  hips.add(legL[0], legR[0])
  // A tunic as deep at the tummy as at the chest, belted low, and the armour
  // over it.
  let torso = partOf(
    fit([
      [[-0.22, -0.04, -0.15], [0.44, 0.46, 0.3], tint, 0.1],
      [[-0.23, 0.02, -0.16], [0.46, 0.07, 0.32], belt],
      [[-0.05, 0.025, 0.16], [0.1, 0.06, 0.01], 0xe7c35a],
      [[-0.15, 0.33, 0.12], [0.3, 0.1, 0.05], shade(tint, 0.8)],
      ...(COATS[weight('body')]?.(tone(worn('body')), tone(worn('body'), 1)) ??
        []),
    ], kt),
    [0, 0, 0],
  )
  hips.add(torso)
  // An upper arm, and a forearm ending in a hand.
  let elbow = b.arm * 0.42, fore = b.arm - elbow, r = b.sleeve
  let hand = b.hand, palm = hand - 0.02
  let arm = (x: number) =>
    limb(
      [[
        [-r / 2, -elbow - 0.02, -r / 2 - 0.005],
        [r, elbow + 0.07, r + 0.01],
        tint,
        0.05,
      ]],
      [
        [
          [0.005 - r / 2, palm - fore - 0.02, -r / 2],
          [r - 0.01, fore - palm + 0.05, r],
          tint,
          0.05,
        ],
        [[-hand / 2, -fore, -hand / 2], [hand, palm, hand], skin, 0.07],
      ],
      [x, b.shoulder[1], 0],
      [0, -elbow, 0],
    )
  let [armL, foreL] = arm(-b.shoulder[0]), [armR, foreR] = arm(b.shoulder[0])
  torso.add(armL, armR)
  // Where a hand holds what it holds, in the forearm's space, and how far
  // above the ground that is as the arm hangs: a staff leant on reaches the
  // ground from there, and its head stands over their own.
  let fist: Vec = [0, palm / 2 - fore - 0.015, 0.03]
  let reach = b.hips + b.shoulder[1] - elbow + fist[1]
  let tip = stature(b) - reach + 0.17
  // Held in the right hand: a blade angled out before them, or a staff or a
  // bow upright; nothing, for a hero with nothing in hand. What goes with it
  // is held in the left.
  let family = dress ? ITEMS[worn('main')]?.family ?? 'fists' : 'sword'
  let upright = staff || family == 'staff' || family == 'bow'
  let held = !dress
    ? partOf(
      staff
        ? [
          [
            [-0.035, -reach, -0.035],
            [0.07, reach + tip, 0.07],
            0x6a4a30,
          ],
          [[-0.07, tip, -0.07], [0.14, 0.12, 0.14], 0x8fd46a],
        ]
        : [
          [[-0.025, -0.07, -0.025], [0.05, 0.14, 0.05], 0x6a4a30],
          [[-0.1, -0.11, -0.035], [0.2, 0.04, 0.07], 0xe2b64c],
          [[-0.03, -0.5, -0.01], [0.06, 0.4, 0.02], 0xdfe6ee],
        ],
      fist,
      0.05,
    )
    : partOf(
      grip(
        worn('main'),
        family == 'staff' ? 0.4 : family == 'bow' ? 0.42 : 'hung',
      ),
      fist,
      0.05,
    )
  foreR.add(held)
  let off = worn('off'), side = ITEMS[off]?.family
  // A blade in the left hand too is held as the right holds its own.
  let twin = ITEMS[off]?.slot == 'main'
  let other = partOf(
    twin ? grip(off, 'hung') : side == 'shield'
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
    fist,
    0.05,
  )
  foreL.add(other)
  let head = partOf(
    fit([
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
    ], kh),
    [0, b.torso[1], 0],
  )
  torso.add(head)
  let cape = partOf(
    fit([[[-0.18, -0.46, -0.03], [0.36, 0.48, 0.035], shade(tint, 0.72)]], kt),
    [0, 0.4 * kt[1], -0.16 * kt[2]],
  )
  torso.add(cape)

  // How the right hand rests: bent a little at the elbow, and what it holds
  // turned upright, a staff or a bow, or out before them, a blade; the left
  // holds its torch upright, and a second blade out before them too.
  let rest = -0.5
  let hold = upright ? -rest : -0.6
  other.rotation.x = twin ? hold : side == 'torch' ? 0.3 : 0
  // A blow, `w` of the way through it, struck with `hand`: the weapon's own.
  let swing = (w: number, hand: Hand = 'main') => {
    let up = lunge(w, 0.35)
    if (family == 'dagger' || family == 'fists') {
      // A stab: the arm drives straight out and back, the body turning
      // behind it, the left arm's the mirror of the right's.
      up = lunge(w, 0.3)
      let [arm, fore, k] = hand == 'off' ? [armL, foreL, -1] : [armR, foreR, 1]
      arm.rotation.x = lerp(0.3, -1.5, up)
      fore.rotation.x = lerp(-1.3, -0.05, up)
      torso.rotation.y = k * lerp(0.25, -0.3, up)
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
  // An ability's own poses, `w` of the way through: arms out for a turn all
  // the way round, the other hand raised before them, both hands up, both
  // arms swept in across each other.
  let POSES: Partial<Record<Pose, (w: number) => void>> = {
    spin: (w) => {
      body.rotation.y = ease(w) * Math.PI * 2
      armR.rotation.x = -1.3
      armR.rotation.z = 0.5
      foreR.rotation.x = -0.2
      armL.rotation.z = -0.9
    },
    guard: (w) => {
      let k = Math.min(1, w / 0.1, (1 - w) / 0.1)
      armL.rotation.x = -1.35 * k
      armL.rotation.z = 0.35 * k
      foreL.rotation.x = -1.1 * k
      torso.rotation.y = -0.25 * k
    },
    cast: (w) => {
      let k = Math.sin(Math.PI * Math.min(1, w * 1.4))
      armL.rotation.x = armR.rotation.x = -2.7 * k
      armL.rotation.z = -0.3 * k
      armR.rotation.z = 0.3 * k
      foreL.rotation.x = foreR.rotation.x = -0.3 * k
      head.rotation.x = -0.3 * k
    },
    cross: (w) => {
      let up = lunge(w, 0.3)
      for (
        let [arm, fore, k] of [[armL, foreL, -1], [armR, foreR, 1]] as const
      ) {
        arm.rotation.x = lerp(0.2, -1.4, up)
        arm.rotation.z = k * lerp(0.5, -0.4, up)
        fore.rotation.x = lerp(-1.4, -0.1, up)
      }
      torso.rotation.x = 0.12 * up
    },
  }
  let phase = 0
  return sewn({
    root,
    material: m,
    height: stature(b) + 0.24,
    animate: (a, dt) => {
      // Shorter legs step quicker to keep up.
      phase += dt * (2 + a.speed * 1.5 / b.hips)
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
      body.rotation.y = 0
      let pose = POSES[a.pose ?? 'swing']
      if (a.swing >= 0) pose ? pose(a.swing) : swing(a.swing, a.hand)
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
  b: Build,
  look: { tint: string; hair: string; skin: string },
  dress: Dress = {},
) => person(b, look, false, dress)

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
