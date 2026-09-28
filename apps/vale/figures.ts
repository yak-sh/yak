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
// knee, big hands and feet. A hero stands 1.3 m. A hero wears
// what they wear: their weapon in the right hand, what goes with it in the
// left, and their armour over their tunic, each drawn from the item's own
// look (items.ts). How they swing is their weapon's: up and over for a blade,
// a stab for a dagger, from each hand in turn with one in each, a draw and a
// loose for a bow, a thrust for a staff. An ability may pose them its own way
// (abilities.ts `Pose`): a turn all the way round, the other hand raised
// before them, both hands up, or both blades across the foe.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import type { Box } from './boxes.ts'
import type { Pose } from './abilities.ts'
import { BEASTS, type Look, type Plans } from './beasts.ts'
import type { Hand } from './gear.ts'
import { halo } from './halo.ts'
import { ITEMS } from './items.ts'
import { biped } from './bodies/biped.ts'
import { bird } from './bodies/bird.ts'
import { crag } from './bodies/crag.ts'
import { crawler } from './bodies/crawler.ts'
import { flier } from './bodies/flier.ts'
import { hopper } from './bodies/hopper.ts'
import { quadruped } from './bodies/quadruped.ts'
import { seal } from './bodies/seal.ts'
import { serpent } from './bodies/serpent.ts'
import { slime } from './bodies/slime.ts'
import { wisp } from './bodies/wisp.ts'
import type { Vec } from './mesh.ts'
import {
  ease,
  fit,
  knit,
  limb,
  lunge,
  partOf,
  shade,
  stride,
  topple,
} from './parts.ts'
import { lerp } from './rand.ts'
import { flash, soft } from './soft.ts'
import { LAND } from './strike.ts'

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
  /** how far the head is turned from the body to look at someone, in
   * radians */
  look?: number
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

// Where a hand closes on each family of thing, in metres up its look from its
// foot (arms.ts), and how it is held: hung from the hand, its foot toward the
// elbow, for what is swung; `across` the fist, square to the forearm as a
// stick is held, its back away from the elbow; stood upright on it for the
// rest, `out` before the hand for what is held up before them.
type Hold = { at: number; hung?: true; across?: true; out?: number }
let HOLDS: Record<string, Hold> = {
  sword: { at: 0.12, hung: true },
  axe: { at: 0.1, hung: true },
  hammer: { at: 0.1, hung: true },
  dagger: { at: 0.09, hung: true },
  bow: { at: 0.45, across: true },
  staff: { at: 0.4 },
  shield: { at: 0.29, out: 0.1 },
  torch: { at: 0.06 },
  tome: { at: 0.03, out: 0.08 },
}

// A thing held, from its look (items.ts), in the hand's space.
let grip = (kind: string): Box[] => {
  let t = ITEMS[kind]
  let h = HOLDS[t?.family ?? ''] ?? { at: 0 }
  let boxes: Box[] = (t?.look ?? []).map((
    [[x, y, z], [w, tall, d], c, round = 0.02],
  ) => [
    [x, h.hung ? h.at - y - tall : y - h.at, z + (h.out ?? 0)],
    [w, tall, d],
    c,
    round,
  ])
  return h.across ? boxes.map(topple) : boxes
}

// A carried thing's glow follows its hand's bone through every pose. One
// sprite per glowing item keeps the figure's single skinned mesh intact.
let gleams = new Map<number, THREE.SpriteMaterial>()

let gleam = (kind: string, hand: THREE.Bone) => {
  let t = ITEMS[kind], a = t?.aura
  if (!a) return
  let h = HOLDS[t.family ?? ''] ?? { at: 0 }
  let m = gleams.get(a.color)
  if (!m) {
    m = new THREE.SpriteMaterial({
      map: halo(),
      color: a.color,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    gleams.set(a.color, m)
  }
  let s = new THREE.Sprite(m)
  s.position.set(a.at[0], a.at[1] - h.at, a.at[2] + (h.out ?? 0))
  s.scale.setScalar(a.size)
  hand.add(s)
}

// The colour of the `i`th box of a kind's look. Cloth's first three boxes
// carry its fabric, trim and gem, shared by the item and the worn figure.
let tone = (kind: string, i = 0) => ITEMS[kind]?.look[i]?.[2] ?? 0x808080

// Armour over a head, by weight, in the head's space.
let HATS: Record<string, (c: number, trim: number, gem: number) => Box[]> = {
  plate: (c, trim) => [
    [[-0.245, 0.2, -0.225], [0.49, 0.27, 0.46], c, 0.06],
    [[-0.03, 0.04, 0.2], [0.06, 0.18, 0.04], c],
    [[-0.03, 0.47, -0.16], [0.06, 0.07, 0.3], trim],
  ],
  leather: (c) => [
    [[-0.245, 0.25, -0.225], [0.49, 0.21, 0.46], c, 0.08],
    [[-0.245, 0.02, -0.235], [0.49, 0.26, 0.09], c],
  ],
  cloth: (c, trim, gem) => [
    [[-0.25, 0.2, -0.23], [0.5, 0.28, 0.48], c, 0.08],
    [[-0.25, 0, -0.23], [0.05, 0.22, 0.36], c],
    [[0.2, 0, -0.23], [0.05, 0.22, 0.36], c],
    [[-0.25, -0.04, -0.24], [0.5, 0.26, 0.09], c],
    [[-0.08, 0.46, -0.2], [0.16, 0.1, 0.18], c, 0.04],
    [[-0.25, 0.2, 0.22], [0.5, 0.045, 0.04], trim],
    [[-0.25, 0.02, 0.12], [0.05, 0.18, 0.12], trim],
    [[0.2, 0.02, 0.12], [0.05, 0.18, 0.12], trim],
    [[-0.045, 0.3, 0.255], [0.09, 0.09, 0.025], gem, 0.025],
  ],
}

// Armour over a middle, by weight, in the torso's space: close over the
// tunic, as deep at the tummy as at the chest.
let COATS: Record<string, (c: number, trim: number, gem: number) => Box[]> = {
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
  cloth: (c, trim, gem) => [
    [[-0.238, 0, -0.168], [0.476, 0.4, 0.336], c, 0.08],
    [[-0.29, -0.31, -0.17], [0.58, 0.35, 0.34], c, 0.06],
    [[-0.243, 0.03, -0.173], [0.486, 0.06, 0.346], trim],
    [[-0.15, -0.3, 0.17], [0.3, 0.33, 0.025], c],
    [[-0.15, -0.3, 0.195], [0.045, 0.33, 0.015], trim],
    [[0.105, -0.3, 0.195], [0.045, 0.33, 0.015], trim],
    [[-0.29, -0.31, -0.175], [0.58, 0.045, 0.355], trim],
    [[-0.27, 0.31, -0.18], [0.54, 0.1, 0.36], c, 0.06],
    [[-0.045, 0.29, 0.185], [0.09, 0.09, 0.025], gem, 0.025],
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

/** The build of a grown person in the vale. */
export let BUILD: Build = {
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
}

/** The smaller build of a child in the vale. */
export let CHILD: Build = {
  hips: 0.32,
  leg: 0.15,
  stance: 0.085,
  boot: [0.16, 0.22],
  torso: [0.37, 0.35, 0.26],
  shoulder: [0.26, 0.29],
  arm: 0.35,
  sleeve: 0.12,
  hand: 0.14,
  head: [0.4, 0.35, 0.36],
}

/** How tall someone of a build stands, ground to crown. */
export let stature = (b: Build) => b.hips + b.torso[1] + b.head[1]

// How a build's `v` fits the usual measure along each axis.
let over = (v: Vec, base: Vec): Vec => [
  v[0] / base[0],
  v[1] / base[1],
  v[2] / base[2],
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
  let boots = weight('feet') == 'cloth' ? skin : feet ? tone(feet) : 0x5a3c28
  let sole = weight('feet') == 'cloth' ? 0.08 : 0.14
  let kt = over(b.torso, BUILD.torso)
  let kh = over(b.head, BUILD.head)
  let root = new THREE.Group()
  let body = new THREE.Group()
  root.add(body)
  let hips = new THREE.Group()
  hips.position.y = b.hips
  body.add(hips)
  // A thigh, and a shin in a boot, bending at the knee.
  let knee = b.hips * 0.45, shin = b.hips - knee, t = b.leg
  let [bw, bl] = b.boot
  let straps: Box[] = weight('feet') == 'cloth'
    ? [
      [[-bw / 2, -shin, -t / 2 - 0.02], [bw, 0.025, bl], tone(feet)],
      [
        [-bw / 2, -shin + sole - 0.03, -t / 2 + 0.03],
        [bw, 0.03, 0.045],
        tone(feet, 1),
      ],
      [
        [-bw / 2, -shin + sole - 0.03, -t / 2 + 0.12],
        [bw, 0.03, 0.045],
        tone(feet),
      ],
    ]
    : []
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
        ...straps,
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
      ...(COATS[weight('body')]?.(
        tone(worn('body')),
        tone(worn('body'), 1),
        tone(worn('body'), 2),
      ) ?? []),
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
  // Held in the right hand: a blade angled out before them, a bow across the
  // fist, or a staff upright; nothing, for a hero with nothing in hand. What
  // goes with it is held in the left.
  let family = dress ? ITEMS[worn('main')]?.family ?? 'fists' : 'sword'
  let grasp = staff ? undefined : HOLDS[family]
  let held = partOf(
    staff
      ? [
        [
          [-0.035, -reach, -0.035],
          [0.07, reach + tip, 0.07],
          0x6a4a30,
        ],
        [[-0.07, tip, -0.07], [0.14, 0.12, 0.14], 0x8fd46a],
      ]
      : grip(dress ? worn('main') : 'sword2'),
    fist,
    0.05,
  )
  foreR.add(held)
  gleam(worn('main'), held)
  let off = worn('off'), side = ITEMS[off]?.family
  // A blade in the left hand too is held as the right holds its own.
  let twin = ITEMS[off]?.slot == 'main'
  let other = partOf(grip(off), fist, 0.05)
  foreL.add(other)
  gleam(off, other)
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
      ...(HATS[weight('head')]?.(
        tone(worn('head')),
        tone(worn('head'), 1),
        tone(worn('head'), 2),
      ) ?? []),
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
  // out before them, a blade, square to the forearm, a bow, or turned
  // upright, a staff; the left holds its torch upright, and a second blade
  // out before them too.
  let rest = -0.5
  let hold = grasp?.hung ? -0.8 : grasp?.across ? 0 : -rest
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
      // Drawn and held to the loose, a third of the way in: the arm out
      // straight before them stands the bow in its fist upright, and the
      // string comes to the chin.
      let d = w < 0.33 ? ease(w / 0.33) : 1 - ease((w - 0.33) / 0.67) * 0.7
      armR.rotation.x = -1.5 * d
      foreR.rotation.x = rest * (1 - d)
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
    } else if (family == 'hammer') {
      // Raise the head before the blow, then bring it down through the hit.
      let wind = ease(Math.min(1, w / 0.12))
      let hit = ease(Math.max(0, Math.min(1, (w - 0.12) / (LAND - 0.12))))
      let back = ease(Math.max(0, Math.min(1, (w - 0.45) / 0.55)))
      let high = wind * (1 - hit), low = hit * (1 - back)
      armR.rotation.x = 0.4 - 2.6 * high - 0.2 * low
      foreR.rotation.x = -0.2 - 0.4 * high - 0.8 * low
      torso.rotation.x = 0.14 * low
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
      head.rotation.set(
        -amp * 0.06,
        a.look ?? Math.sin(a.t * 0.7) * 0.15 * (1 - amp),
        0,
      )
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
  seal,
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
